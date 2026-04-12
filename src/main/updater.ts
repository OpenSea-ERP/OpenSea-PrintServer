import { autoUpdater } from 'electron-updater';
import log from 'electron-log';
import { BrowserWindow } from 'electron';

autoUpdater.logger = log;
autoUpdater.autoDownload = true;
autoUpdater.autoInstallOnAppQuit = true;

function sendStatusToRenderer(channel: string, data?: unknown): void {
  const windows = BrowserWindow.getAllWindows();
  for (const win of windows) {
    if (!win.isDestroyed()) {
      win.webContents.send(channel, data);
    }
  }
}

function setupUpdater(): void {
  autoUpdater.on('checking-for-update', () => {
    log.info('[updater] Verificando atualizações...');
    sendStatusToRenderer('updater:status', { status: 'checking' });
  });

  autoUpdater.on('update-available', (info) => {
    log.info('[updater] Atualização disponível:', info.version);
    sendStatusToRenderer('updater:status', {
      status: 'available',
      version: info.version,
    });
  });

  autoUpdater.on('update-not-available', () => {
    log.info('[updater] Nenhuma atualização disponível');
    sendStatusToRenderer('updater:status', { status: 'up-to-date' });
  });

  autoUpdater.on('download-progress', (progress) => {
    log.info(`[updater] Download: ${Math.round(progress.percent)}%`);
    sendStatusToRenderer('updater:status', {
      status: 'downloading',
      progress: progress.percent,
    });
  });

  autoUpdater.on('update-downloaded', (info) => {
    log.info('[updater] Atualização baixada:', info.version);
    sendStatusToRenderer('updater:status', {
      status: 'downloaded',
      version: info.version,
    });
  });

  autoUpdater.on('error', (error) => {
    log.error('[updater] Erro na atualização:', error);
    sendStatusToRenderer('updater:status', {
      status: 'error',
      error: error?.message ?? 'Erro desconhecido',
    });
  });
}

async function checkForUpdates(): Promise<void> {
  try {
    await autoUpdater.checkForUpdates();
  } catch (error) {
    log.error('[updater] Erro ao verificar atualizações:', error);
  }
}

function quitAndInstall(): void {
  autoUpdater.quitAndInstall(false, true);
}

export { setupUpdater, checkForUpdates, quitAndInstall };
