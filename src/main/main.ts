import {
  app,
  BrowserWindow,
  Tray,
  Menu,
  nativeImage,
  Notification,
  dialog,
} from "electron";
import path from "path";
import log from "electron-log";
import { registerIpcHandlers } from "./ipc-handlers";
import { setupUpdater, checkForUpdates } from "./updater";
import { setup as setupAutoLaunch } from "./auto-launch";
import { store, migrateStaleApiUrl } from "./store";
import { PrintServerWSClient } from "./ws-client";
import { setConnected } from "./connection-state";
import { getDeviceToken } from "./secure-store";
import { executePrint } from "./print-handler";
import { detectorToBackend } from "./printer-status";

log.transports.file.level = "info";
log.transports.console.level = "debug";
log.transports.file.maxSize = 10 * 1024 * 1024; // 10MB rotation

let mainWindow: BrowserWindow | null = null;
let tray: Tray | null = null;
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
    void handlePrintCommand(
      message.jobId,
      message.printerId,
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
wsClient.on("release", (msg: { kind: string; version: string }) => {
  if (msg.kind !== "PRINT_SERVER") {
    log.debug(`[ws] Ignorando release para kind=${msg.kind}`);
    return;
  }
  log.info(`[ws] Release ${msg.version} anunciada via WS — disparando updater`);
  checkForUpdates().catch((err) => {
    log.error("[ws] checkForUpdates após release.published falhou:", err);
  });
});

// Satellite Contract v1: backend revoked our pairing (admin clicked
// "Unpair" or a security action force-revoked the device). The socket
// will close with 4003 right after this message; we proactively notify
// the renderer so the pair page replaces the dashboard immediately
// instead of waiting for the next reconnect attempt to fail visibly.
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
    });
    return;
  }

  const result = await executePrint(jobId, printerName, buffer, copies);
  wsClient.send({
    type: "print-result",
    jobId,
    success: result.success,
    error: result.error,
  });

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

function createTray(): void {
  const iconPath = getAssetPath("icon.png");
  let trayIcon: Electron.NativeImage;

  try {
    trayIcon = nativeImage.createFromPath(iconPath);
    if (trayIcon.isEmpty()) {
      trayIcon = nativeImage.createEmpty();
    }
  } catch {
    trayIcon = nativeImage.createEmpty();
  }

  tray = new Tray(trayIcon);
  tray.setToolTip("OpenSea Print Server");

  updateTrayMenu(false);

  tray.on("double-click", () => {
    showMainWindow();
  });

  log.info("[main] Ícone na bandeja criado");
}

function updateTrayMenu(isOnline: boolean): void {
  if (!tray) return;

  const statusLabel = isOnline ? "Status: Online" : "Status: Offline";

  const contextMenu = Menu.buildFromTemplate([
    {
      label: "Abrir",
      click: () => {
        showMainWindow();
      },
    },
    { type: "separator" },
    {
      label: statusLabel,
      enabled: false,
    },
    {
      label: `Versão ${app.getVersion()}`,
      enabled: false,
    },
    { type: "separator" },
    {
      label: "Verificar Atualizações",
      click: () => {
        // Notify renderer this is a manual check (show all states)
        const windows = BrowserWindow.getAllWindows();
        for (const win of windows) {
          if (!win.isDestroyed()) {
            win.webContents.send("updater:manual-check");
          }
        }
        // Show window so user sees the modal
        showMainWindow();
        checkForUpdates().catch((err) => {
          log.error("[tray] Erro ao verificar atualizações:", err);
        });
      },
    },
    { type: "separator" },
    {
      label: "Sair",
      click: () => {
        isQuitting = true;
        app.quit();
      },
    },
  ]);

  tray.setContextMenu(contextMenu);
}

// ── App lifecycle ────────────────────────────────────────────────────────

const gotTheLock = app.requestSingleInstanceLock();

if (!gotTheLock) {
  log.info("[main] Outra instância já está rodando, encerrando");
  try {
    dialog.showErrorBox(
      "OpenSea Print Server",
      "Já existe uma instância em execução. Abra o ícone na bandeja do sistema.",
    );
  } catch {
    // dialog pode não estar pronto
  }
  app.quit();
} else {
  app.on("second-instance", () => {
    showMainWindow();
  });

  app.on("ready", async () => {
    log.info("[main] Aplicação pronta");

    // Reescreve apiUrl obsoleto (ex.: localhost herdado de instalações
    // 1.4.0–1.6.0) antes de qualquer IPC. Sem isso o `agent:pair` falha
    // com `URL da API inválida` em produção.
    migrateStaleApiUrl();

    Menu.setApplicationMenu(null);

    registerIpcHandlers();
    setupUpdater();

    createWindow();
    createTray();

    await setupAutoLaunch().catch((err) => {
      log.error("[main] Erro ao configurar auto-launch:", err);
    });

    // Connect WebSocket if already paired
    await connectWebSocket().catch((err) => {
      log.error("[main] Erro ao conectar WebSocket inicial:", err);
    });

    await checkForUpdates().catch((err) => {
      log.error("[main] Erro ao verificar atualizações:", err);
    });
  });

  app.on("before-quit", (event) => {
    if (isQuitting) return;
    isQuitting = true;
    event.preventDefault();
    log.info("[main] before-quit: desconectando WebSocket...");
    try {
      wsClient.send({ type: "status", status: "OFFLINE" });
    } catch {
      // noop
    }
    disconnectWebSocket();
    setTimeout(() => {
      log.info("[main] Encerrando app após cleanup");
      app.exit(0);
    }, 500);
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
}

export { updateTrayMenu, connectWebSocket, disconnectWebSocket };
