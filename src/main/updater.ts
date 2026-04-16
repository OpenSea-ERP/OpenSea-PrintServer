import { autoUpdater } from 'electron-updater';
import log from 'electron-log';
import { BrowserWindow } from 'electron';
import { store } from './store';

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
    // Persistir para que o renderer ainda veja o estado após reabrir o app
    store.set('pendingUpdateVersion', info.version);
    sendStatusToRenderer('updater:status', {
      status: 'downloaded',
      version: info.version,
    });
  });

  autoUpdater.on('error', (error) => {
    const message = error?.message ?? 'Erro desconhecido';
    log.error('[updater] Erro na atualização:', error);
    sendStatusToRenderer('updater:status', {
      status: 'error',
      error: message,
      message, // alias compatível com UIs mais novas
    });
  });

  // Se existe update baixado de execução anterior, re-emite estado pro renderer
  // assim que a primeira janela estiver pronta.
  const pending = store.get('pendingUpdateVersion');
  if (pending) {
    log.info(`[updater] Update ${pending} pendente de instalação (de sessão anterior)`);
    // Delay para garantir que a janela exista
    setTimeout(() => {
      sendStatusToRenderer('updater:status', {
        status: 'downloaded',
        version: pending,
      });
    }, 2000);
  }
}

async function checkForUpdates(): Promise<void> {
  try {
    await autoUpdater.checkForUpdates();
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    log.error('[updater] Erro ao verificar atualizações:', error);
    // Propaga erro para renderer em vez de engolir silencioso
    sendStatusToRenderer('updater:status', {
      status: 'error',
      error: message,
      message,
    });
    throw error;
  }
}

function quitAndInstall(): void {
  store.set('pendingUpdateVersion', null);
  autoUpdater.quitAndInstall(false, true);
}

export { setupUpdater, checkForUpdates, quitAndInstall };
