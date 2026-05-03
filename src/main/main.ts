import { app, BrowserWindow, Menu, Notification } from "electron";
import path from "path";
import { setupLog, getLogger } from "@opensea/satellite-runtime/log";
import { ensureSingleInstance } from "@opensea/satellite-runtime/single-instance";
import {
  setupAutoLaunch,
  enableAutoLaunch,
  disableAutoLaunch,
  isAutoLaunchEnabled,
} from "@opensea/satellite-runtime/auto-launch";
import { restoreWindowState } from "@opensea/satellite-runtime/window-state";
import {
  createSatelliteTray,
  type SatelliteTrayHandle,
} from "@opensea/satellite-runtime/tray";
import {
  registerShutdownHandler,
  runShutdownHandlers,
} from "@opensea/satellite-runtime/graceful-shutdown";
import { registerIpcHandlers } from "./ipc-handlers";
import {
  setupUpdater,
  checkForUpdates,
  recordAnnouncedRelease,
  primeUpdaterStore,
} from "@opensea/satellite-runtime/updater";
import { store, migrateStaleApiUrl } from "./store";
import { PrintServerWSClient } from "./ws-client";
import { setConnected } from "./connection-state";
import { getDeviceToken } from "./secure-store";
import { executePrint } from "./print-handler";
import { detectorToBackend } from "./printer-status";

setupLog({ scope: "print-server" });
const log = getLogger("main");

let mainWindow: BrowserWindow | null = null;
let trayHandle: SatelliteTrayHandle | null = null;
let isQuitting = false;
const wsClient = new PrintServerWSClient();

const wasOpenedAsHidden =
  process.argv.includes("--hidden") ||
  app.getLoginItemSettings().wasOpenedAsHidden;

function sendToRenderer(channel: string, data?: unknown): void {
  const windows = BrowserWindow.getAllWindows();
  for (const win of windows) {
    if (!win.isDestroyed()) {
      win.webContents.send(channel, data);
    }
  }
}

async function connectWebSocket(): Promise<void> {
  const deviceToken = await getDeviceToken();
  const apiUrl = store.get("apiUrl");
  if (!deviceToken) {
    log.info("[main] Sem deviceToken, WebSocket não conectado");
    return;
  }

  const wsUrl = apiUrl.replace(/^http/, "ws");
  log.info(`[main] Conectando WebSocket: ${wsUrl}`);
  wsClient.connect(wsUrl, deviceToken);
}

function disconnectWebSocket(): void {
  wsClient.disconnect();
}

// Track connection state and send to renderer
wsClient.on("state", (state: string) => {
  const isOnline = state === "connected";
  setConnected(isOnline);
  sendToRenderer("connection:status", isOnline ? "connected" : "disconnected");
  updateTrayMenu(isOnline);

  // Send printer list to backend on connect
  if (isOnline) {
    sendPrintersToBackend();
  }
});

// Handle incoming commands from backend
wsClient.onMessage((message) => {
  if (message.type === "request-printers") {
    sendPrintersToBackend();
    return;
  }

  if (message.type === "print") {
    // Prefer the new `printerName` field; fall back to the legacy
    // `printerId` whose value carries the OS device name (transitional —
    // see ws-client.ts for the full migration story).
    const printerName = message.printerName ?? message.printerId;
    void handlePrintCommand(
      message.jobId,
      printerName,
      message.data,
      message.copies,
    );
  }
});

// Satellite Contract v1: when the backend broadcasts a new release for
// our kind, fold the notification straight into the auto-updater pipeline
// so users do not have to wait for the periodic poll to discover an
// update. Releases for OTHER satellite kinds (EMPORION, HORUS) are
// ignored — the validator already accepts every kind, the filter belongs
// at the consumer.
wsClient.on(
  "release",
  (msg: {
    kind: string;
    version: string;
    downloadUrl: string;
    sha256: string;
  }) => {
    if (msg.kind !== "PRINT_SERVER") {
      log.debug(`[ws] Ignorando release para kind=${msg.kind}`);
      return;
    }
    log.info(
      `[ws] Release ${msg.version} anunciada via WS — disparando updater`,
    );
    recordAnnouncedRelease({
      version: msg.version,
      downloadUrl: msg.downloadUrl,
      sha256: msg.sha256,
    });
    checkForUpdates().catch((err) => {
      log.error("[ws] checkForUpdates após release.published falhou:", err);
    });
  },
);

// Satellite Contract v1: backend revoked our pairing.
wsClient.on("revoked", (msg: { reason: string }) => {
  log.warn(`[ws] device.revoked recebido (reason=${msg.reason})`);
  sendToRenderer("device:revoked", { reason: msg.reason });
});

async function handlePrintCommand(
  jobId: string,
  printerName: string,
  dataBase64: string,
  copies: number,
): Promise<void> {
  const startedAt = Date.now();
  let buffer: Buffer;
  try {
    buffer = Buffer.from(dataBase64, "base64");
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    log.error(`[main] Job ${jobId}: base64 inválido — ${msg}`);
    wsClient.send({
      type: "print-result",
      jobId,
      success: false,
      error: "base64 inválido",
      durationMs: Date.now() - startedAt,
    });
    return;
  }

  const result = await executePrint(jobId, printerName, buffer, copies);
  const durationMs = Date.now() - startedAt;
  wsClient.send({
    type: "print-result",
    jobId,
    success: result.success,
    error: result.error,
    durationMs,
  });

  log.info(
    `[main] Job ${jobId}: concluído em ${durationMs}ms (success=${result.success})`,
  );
  notifyPrintResult(jobId, printerName, result.success, result.error);
}

function notifyPrintResult(
  jobId: string,
  printerName: string,
  success: boolean,
  error?: string,
): void {
  try {
    if (!Notification.isSupported()) return;
    const title = success ? "Impressão concluída" : "Falha na impressão";
    const body = success
      ? `Job ${jobId.slice(0, 8)} enviado para ${printerName}`
      : `Job ${jobId.slice(0, 8)}: ${error ?? "erro desconhecido"}`;
    new Notification({ title, body, silent: true }).show();
  } catch (err) {
    log.debug("[main] Notification falhou:", err);
  }
}

async function sendPrintersToBackend(): Promise<void> {
  try {
    const { detectPrinters, clearPrinterCache } =
      await import("./printer-detector");
    clearPrinterCache();
    const detected = await detectPrinters();

    const printers = detected.map((p) => ({
      name: p.name,
      type: p.type,
      isDefault: p.isDefault,
      status: detectorToBackend(p.status),
    }));

    wsClient.send({ type: "printers", printers });
    log.info(`[main] Enviadas ${printers.length} impressoras ao backend`);
  } catch (err) {
    log.error("[main] Erro ao enviar impressoras:", err);
  }
}

function getAssetPath(filename: string): string {
  return path.join(__dirname, "..", "..", "assets", filename);
}

function showMainWindow(): void {
  if (!mainWindow) return;
  if (mainWindow.isMinimized()) mainWindow.restore();
  mainWindow.setSkipTaskbar(false);
  mainWindow.show();
  mainWindow.focus();
}

/**
 * Reconcile legacy `store.autoLaunch` (PrintServer 1.6.x and earlier) with the
 * satellite-runtime auto-launch preference store. Runs once per install.
 *
 * Logic:
 *   - If `autoLaunchBridged` is already true → no-op (already migrated).
 *   - Else, read the legacy `autoLaunch` flag and call enable/disable on the
 *     runtime accordingly (which writes to the runtime's namespaced pref store).
 *   - Mark `autoLaunchBridged = true` so subsequent boots skip this code.
 *
 * In dev (`!app.isPackaged`) the runtime devGuard makes enable/disable no-op
 * — that is the desired behavior; we still flip `autoLaunchBridged` so prod
 * boots a single canonical bridge after install.
 */
async function bridgeAutoLaunchPreference(): Promise<void> {
  if (store.get("autoLaunchBridged")) return;
  const legacy = store.get("autoLaunch");
  log.info(
    `[main] Bridging legacy auto-launch preference (legacy=${legacy}) into runtime`,
  );
  try {
    if (legacy) {
      await enableAutoLaunch("OpenSea Print Server", true);
    } else {
      await disableAutoLaunch("OpenSea Print Server");
    }
  } finally {
    store.set("autoLaunchBridged", true);
  }
  // Sanity check (also exercises isAutoLaunchEnabled in prod):
  if (app.isPackaged) {
    const finalState = await isAutoLaunchEnabled("OpenSea Print Server");
    log.info(`[main] Auto-launch bridge done; final state=${finalState}`);
  }
}

/**
 * Reconcile legacy `store.{pendingUpdateVersion, lastFailedUpdateAt}`
 * (PrintServer 1.6.x stored these in its own `config` electron-store) with
 * the runtime's `updater.preferences` store. Runs once per install.
 *
 * Uses `primeUpdaterStore` which is idempotent — only writes a key if the
 * runtime store still holds the schema default (null). Subsequent boots
 * skip via the `updaterBridged` flag.
 *
 * Synchronous because primeUpdaterStore + store reads are sync (electron-store
 * is sync). Failure is non-fatal: even without the bridge, the runtime
 * still works; user just loses pre-migration pending notifications. (Spec
 * amendment B-A2.)
 */
function bridgeUpdaterState(): void {
  if (store.get("updaterBridged")) return;
  const legacyPending = store.get("pendingUpdateVersion");
  const legacyFailed = store.get("lastFailedUpdateAt");
  if (legacyPending !== null || legacyFailed !== null) {
    log.info(
      `[main] Bridging legacy updater state (pending=${legacyPending}, failedAt=${legacyFailed}) into runtime`,
    );
    primeUpdaterStore({
      pendingUpdateVersion: legacyPending,
      lastFailedUpdateAt: legacyFailed,
    });
  }
  store.set("updaterBridged", true);
}

function createWindow(): BrowserWindow {
  mainWindow = new BrowserWindow({
    width: 440,
    height: 780,
    resizable: false,
    frame: true,
    autoHideMenuBar: true,
    titleBarStyle: "default",
    icon: getAssetPath("icon.png"),
    show: !wasOpenedAsHidden,
    skipTaskbar: wasOpenedAsHidden,
    webPreferences: {
      preload: path.join(__dirname, "preload.js"),
      contextIsolation: true,
      nodeIntegration: false,
    },
  });

  // Persist size/position via runtime window-state. Defaults match the
  // hard-coded baseline above so first-run layout is unchanged.
  restoreWindowState(mainWindow, "main-window", { width: 440, height: 780 });

  const rendererPath = path.join(__dirname, "..", "renderer", "index.html");
  mainWindow.loadFile(rendererPath);

  if (!app.isPackaged) {
    mainWindow.webContents.openDevTools({ mode: "detach" });
  }

  mainWindow.on("close", (event) => {
    if (!isQuitting && store.get("minimizeToTray")) {
      event.preventDefault();
      mainWindow?.hide();
      log.info("[main] Janela minimizada para a bandeja");
    }
  });

  mainWindow.on("closed", () => {
    mainWindow = null;
  });

  log.info("[main] Janela principal criada");
  return mainWindow;
}

function buildTrayCustomItems(
  isOnline: boolean,
): Electron.MenuItemConstructorOptions[] {
  const statusLabel = isOnline ? "Status: Online" : "Status: Offline";
  return [
    { label: "Abrir", click: () => showMainWindow() },
    { type: "separator" },
    { label: statusLabel, enabled: false },
    { label: `Versão ${app.getVersion()}`, enabled: false },
    { type: "separator" },
    {
      label: "Verificar Atualizações",
      click: () => {
        const windows = BrowserWindow.getAllWindows();
        for (const win of windows) {
          if (!win.isDestroyed()) {
            win.webContents.send("updater:manual-check");
          }
        }
        showMainWindow();
        checkForUpdates().catch((err) => {
          log.error("[tray] Erro ao verificar atualizações:", err);
        });
      },
    },
  ];
}

function createTray(): void {
  trayHandle = createSatelliteTray({
    iconPath: getAssetPath("icon.png"),
    appName: "OpenSea Print Server",
    onShow: () => showMainWindow(),
    onQuit: () => {
      isQuitting = true;
      app.quit();
    },
    customMenuItems: buildTrayCustomItems(false),
  });
  log.info("[main] Ícone na bandeja criado");
}

function updateTrayMenu(isOnline: boolean): void {
  if (!trayHandle) return;
  // Rebuild full menu (custom items + default Show/Quit) using runtime layout
  const custom = buildTrayCustomItems(isOnline);
  trayHandle.updateMenu([
    ...custom,
    { type: "separator" },
    { label: "Mostrar OpenSea Print Server", click: () => showMainWindow() },
    { type: "separator" },
    {
      label: "Sair",
      click: () => {
        isQuitting = true;
        app.quit();
      },
    },
  ]);
}

// ── App lifecycle ────────────────────────────────────────────────────────

ensureSingleInstance({
  onSecondInstance: () => {
    showMainWindow();
  },
});

app.on("ready", async () => {
  log.info("[main] Aplicação pronta");

  // Reescreve apiUrl obsoleto (ex.: localhost herdado de instalações
  // 1.4.0–1.6.0) antes de qualquer IPC. Sem isso o `agent:pair` falha
  // com `URL da API inválida` em produção.
  migrateStaleApiUrl();

  Menu.setApplicationMenu(null);

  registerIpcHandlers();
  // Bridge legacy updater state from PrintServer's `config` store to the
  // runtime's `updater.preferences` store BEFORE setupUpdater so the
  // pending-update re-emit on first boot post-migration uses the seeded
  // value (Spec amendment B-A2).
  bridgeUpdaterState();
  setupUpdater({
    // PrintServer's NSIS has not been audited for silent install; preserve
    // pre-migration behavior `(false, true)` until that audit is done
    // (Spec amendment B-A3). Default would be `(true, true)`.
    quitAndInstallFlags: { silent: false, forceRunAfter: true },
  });

  createWindow();
  createTray();

  // One-shot bridge: copy the legacy `store.autoLaunch` preference into the
  // satellite-runtime auto-launch store the first time we boot post-migration.
  // Without this, users who had auto-launch enabled in 1.6.x would see it
  // reset to `false` (runtime default) on upgrade (Codex review fix
  // 2026-05-03).
  await bridgeAutoLaunchPreference().catch((err) => {
    log.error("[main] Erro na bridge legacy de auto-launch:", err);
  });

  await setupAutoLaunch({
    name: "OpenSea Print Server",
    isHidden: true,
  }).catch((err) => {
    log.error("[main] Erro ao configurar auto-launch:", err);
  });

  // Register shutdown handlers for graceful quit (runtime once-guarded).
  registerShutdownHandler(
    async () => {
      try {
        wsClient.send({ type: "status", status: "OFFLINE" });
      } catch {
        // socket already closed — ignore
      }
      disconnectWebSocket();
    },
    { name: "ws-disconnect", timeoutMs: 1500 },
  );
  registerShutdownHandler(
    () => {
      trayHandle?.destroy();
    },
    { name: "tray-destroy", timeoutMs: 500 },
  );

  // Connect WebSocket if already paired
  await connectWebSocket().catch((err) => {
    log.error("[main] Erro ao conectar WebSocket inicial:", err);
  });

  await checkForUpdates().catch((err) => {
    log.error("[main] Erro ao verificar atualizações:", err);
  });
});

// `isQuitting` apenas evita o close-to-tray em `mainWindow.on('close')`.
// A reentrância dos handlers é garantida pelo once-guard de `runShutdownHandlers`,
// não por flag local — assim o tray quit (que setava `isQuitting=true` e chamava
// `app.quit()`) também passa pelo shutdown completo (Codex review 2026-05-03).
let shutdownInFlight = false;

app.on("before-quit", async (event) => {
  if (shutdownInFlight) return;
  shutdownInFlight = true;
  isQuitting = true;
  event.preventDefault();
  log.info("[main] before-quit: rodando shutdown handlers...");
  await runShutdownHandlers();
  log.info("[main] Encerrando app");
  app.exit(0);
});

app.on("window-all-closed", () => {
  if (process.platform !== "darwin") {
    app.quit();
  }
});

app.on("activate", () => {
  if (mainWindow === null) {
    createWindow();
  } else {
    showMainWindow();
  }
});

export { updateTrayMenu, connectWebSocket, disconnectWebSocket };
