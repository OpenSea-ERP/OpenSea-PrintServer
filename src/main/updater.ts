/**
 * Auto-updater — usa electron-updater + GitHub Releases.
 *
 * Padrão canônico do Satellite Contract v1 (paridade com Horus + Emporion):
 *   - Boot check + verificação periódica a cada 6h (CHECK_INTERVAL_6H).
 *   - On error: persiste lastFailedUpdateAt + retry em 24h (RETRY_24H).
 *   - On update-downloaded: persiste pendingUpdateVersion + notifica renderer.
 */
import { autoUpdater } from "electron-updater";
import log from "electron-log";
import { BrowserWindow } from "electron";
import { store } from "./store";

autoUpdater.logger = log;
autoUpdater.autoDownload = true;
autoUpdater.autoInstallOnAppQuit = true;

// ── Timing constants ──────────────────────────────────────────────────────────
/** 24-hour flat retry on failure — paridade com Horus + Emporion. */
export const RETRY_24H = 24 * 60 * 60 * 1000;
/** 6-hour periodic check interval — paridade com Horus + Emporion. */
export const CHECK_INTERVAL_6H = 6 * 60 * 60 * 1000;

// ── Module-level state ────────────────────────────────────────────────────────
let retryTimer: ReturnType<typeof setTimeout> | null = null;
let checkInterval: ReturnType<typeof setInterval> | null = null;

/**
 * Last release announced over the WebSocket via the Satellite Contract
 * `app.release.published` event. We keep the announcement so the updater
 * lifecycle handlers can cross-check the version that electron-updater
 * actually downloaded against what the backend said it published — a
 * mismatch usually means the update channel and the broadcast are out
 * of sync, which is worth a loud log line in production.
 *
 * `sha256` is informational here: electron-updater already validates the
 * artefact against the sha512 in `latest.yml`. We log the announced
 * sha256 so an operator can compare manually if a tamper is ever
 * suspected.
 */
interface AnnouncedRelease {
  version: string;
  downloadUrl: string;
  sha256: string;
  announcedAt: number;
}
let announcedRelease: AnnouncedRelease | null = null;

/**
 * Record a release announcement received over the satellite WebSocket.
 * Called from main.ts when `app.release.published` for kind=PRINT_SERVER
 * arrives.
 */
export function recordAnnouncedRelease(release: {
  version: string;
  downloadUrl: string;
  sha256: string;
}): void {
  announcedRelease = { ...release, announcedAt: Date.now() };
  log.info(
    `[updater] Release ${release.version} anunciada via WS — url=${release.downloadUrl} sha256=${release.sha256.slice(0, 16)}…`,
  );
}

function sendStatusToRenderer(channel: string, data?: unknown): void {
  const windows = BrowserWindow.getAllWindows();
  for (const win of windows) {
    if (!win.isDestroyed()) {
      win.webContents.send(channel, data);
    }
  }
}

function setupUpdater(): void {
  // Idempotência: limpar timers e listeners de uma chamada anterior antes de
  // re-registrar — defende contra double-init em test setup ou rebind.
  if (retryTimer) {
    clearTimeout(retryTimer);
    retryTimer = null;
  }
  if (checkInterval) {
    clearInterval(checkInterval);
    checkInterval = null;
  }
  autoUpdater.removeAllListeners("checking-for-update");
  autoUpdater.removeAllListeners("update-available");
  autoUpdater.removeAllListeners("update-not-available");
  autoUpdater.removeAllListeners("download-progress");
  autoUpdater.removeAllListeners("update-downloaded");
  autoUpdater.removeAllListeners("error");

  autoUpdater.on("checking-for-update", () => {
    log.info("[updater] Verificando atualizações...");
    sendStatusToRenderer("updater:status", { status: "checking" });
  });

  autoUpdater.on("update-available", (info) => {
    log.info("[updater] Atualização disponível:", info.version);
    if (announcedRelease && announcedRelease.version !== info.version) {
      log.warn(
        `[updater] Versão divergente: backend anunciou ${announcedRelease.version} via WS, electron-updater encontrou ${info.version}. Channel e release broadcast podem estar dessincronizados.`,
      );
    }
    sendStatusToRenderer("updater:status", {
      status: "available",
      version: info.version,
    });
  });

  autoUpdater.on("update-not-available", () => {
    log.info("[updater] Nenhuma atualização disponível");
    sendStatusToRenderer("updater:status", { status: "up-to-date" });
  });

  autoUpdater.on("download-progress", (progress) => {
    log.info(`[updater] Download: ${Math.round(progress.percent)}%`);
    sendStatusToRenderer("updater:status", {
      status: "downloading",
      progress: progress.percent,
    });
  });

  autoUpdater.on("update-downloaded", (info) => {
    log.info("[updater] Atualização baixada:", info.version);
    // electron-updater already validates the artefact against the
    // sha512 declared in `latest.yml`. The Satellite Contract carries
    // an additional sha256 we logged on announcement — surface it here
    // alongside the downloaded version so an operator can correlate
    // both hashes if a tamper is ever suspected.
    if (announcedRelease) {
      if (announcedRelease.version === info.version) {
        log.info(
          `[updater] Download bateu com release anunciada (v${info.version}, sha256 anunciado=${announcedRelease.sha256.slice(0, 16)}…)`,
        );
      } else {
        log.warn(
          `[updater] Download v${info.version} NÃO bate com release anunciada v${announcedRelease.version}. Investigar antes de instalar.`,
        );
      }
    }
    // Persistir para que o renderer ainda veja o estado após reabrir o app
    store.set("pendingUpdateVersion", info.version);
    sendStatusToRenderer("updater:status", {
      status: "downloaded",
      version: info.version,
    });
  });

  autoUpdater.on("error", (error) => {
    const message = error?.message ?? "Erro desconhecido";
    log.error("[updater] Erro na atualização:", error);

    store.set("lastFailedUpdateAt", Date.now());

    sendStatusToRenderer("updater:status", {
      status: "error",
      error: message,
      message, // alias compatível com UIs mais novas
      lastFailedAt: store.get("lastFailedUpdateAt"),
    });

    // Retry plano em 24h (paridade com Horus + Emporion).
    if (retryTimer) clearTimeout(retryTimer);
    retryTimer = setTimeout(() => {
      log.info("[updater] Retry 24h — verificando atualizações novamente...");
      void autoUpdater
        .checkForUpdates()
        .catch((e) => log.warn("[updater] retry 24h falhou:", e));
    }, RETRY_24H);
  });

  // Se existe update baixado de execução anterior, re-emite estado pro renderer
  // assim que a primeira janela estiver pronta.
  const pending = store.get("pendingUpdateVersion");
  if (pending) {
    log.info(
      `[updater] Update ${pending} pendente de instalação (de sessão anterior)`,
    );
    // Delay para garantir que a janela exista
    setTimeout(() => {
      sendStatusToRenderer("updater:status", {
        status: "downloaded",
        version: pending,
      });
    }, 2000);
  }

  // Verificação periódica a cada 6h (paridade com Horus + Emporion). O boot-check
  // continua sendo disparado externamente em main.ts via checkForUpdates().
  if (checkInterval) clearInterval(checkInterval);
  checkInterval = setInterval(() => {
    log.info("[updater] Verificação periódica 6h...");
    void autoUpdater
      .checkForUpdates()
      .catch((e) => log.warn("[updater] check 6h falhou:", e));
  }, CHECK_INTERVAL_6H);
}

async function checkForUpdates(): Promise<void> {
  try {
    await autoUpdater.checkForUpdates();
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    log.error("[updater] Erro ao verificar atualizações:", error);
    // Propaga erro para renderer em vez de engolir silencioso
    sendStatusToRenderer("updater:status", {
      status: "error",
      error: message,
      message,
    });
    throw error;
  }
}

function quitAndInstall(): void {
  store.set("pendingUpdateVersion", null);
  autoUpdater.quitAndInstall(false, true);
}

export { setupUpdater, checkForUpdates, quitAndInstall };
