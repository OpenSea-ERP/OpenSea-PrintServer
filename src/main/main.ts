import { app, BrowserWindow, Tray, Menu, nativeImage } from 'electron';
import path from 'path';
import log from 'electron-log';
import { registerIpcHandlers } from './ipc-handlers';
import { setupUpdater, checkForUpdates } from './updater';
import { setup as setupAutoLaunch } from './auto-launch';
import { store } from './store';

log.transports.file.level = 'info';
log.transports.console.level = 'debug';

let mainWindow: BrowserWindow | null = null;
let tray: Tray | null = null;
let isQuitting = false;

function getAssetPath(filename: string): string {
  return path.join(__dirname, '..', '..', 'assets', filename);
}

function createWindow(): BrowserWindow {
  mainWindow = new BrowserWindow({
    width: 440,
    height: 680,
    resizable: false,
    frame: true,
    autoHideMenuBar: true,
    titleBarStyle: 'default',
    icon: getAssetPath('icon.png'),
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
    },
  });

  const rendererPath = path.join(__dirname, '..', 'renderer', 'index.html');
  mainWindow.loadFile(rendererPath);

  if (!app.isPackaged) {
    mainWindow.webContents.openDevTools({ mode: 'detach' });
  }

  mainWindow.on('close', (event) => {
    if (!isQuitting && store.get('minimizeToTray')) {
      event.preventDefault();
      mainWindow?.hide();
      log.info('[main] Janela minimizada para a bandeja');
    }
  });

  mainWindow.on('closed', () => {
    mainWindow = null;
  });

  log.info('[main] Janela principal criada');
  return mainWindow;
}

function createTray(): void {
  const iconPath = getAssetPath('icon.png');
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
  tray.setToolTip('OpenSea Print Server');

  updateTrayMenu(false);

  tray.on('double-click', () => {
    if (mainWindow) {
      mainWindow.show();
      mainWindow.focus();
    }
  });

  log.info('[main] Ícone na bandeja criado');
}

function updateTrayMenu(isOnline: boolean): void {
  if (!tray) return;

  const statusLabel = isOnline ? 'Status: Online' : 'Status: Offline';

  const contextMenu = Menu.buildFromTemplate([
    {
      label: 'Abrir',
      click: () => {
        if (mainWindow) {
          mainWindow.show();
          mainWindow.focus();
        }
      },
    },
    { type: 'separator' },
    {
      label: statusLabel,
      enabled: false,
    },
    {
      label: `Versão ${app.getVersion()}`,
      enabled: false,
    },
    { type: 'separator' },
    {
      label: 'Verificar Atualizações',
      click: () => {
        // Notify renderer this is a manual check (show all states)
        const windows = BrowserWindow.getAllWindows();
        for (const win of windows) {
          if (!win.isDestroyed()) {
            win.webContents.send('updater:manual-check');
          }
        }
        // Show window so user sees the modal
        if (mainWindow) {
          mainWindow.show();
          mainWindow.focus();
        }
        checkForUpdates().catch((err) => {
          log.error('[tray] Erro ao verificar atualizações:', err);
        });
      },
    },
    { type: 'separator' },
    {
      label: 'Sair',
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
  log.info('[main] Outra instância já está rodando, encerrando');
  app.quit();
} else {
  app.on('second-instance', () => {
    if (mainWindow) {
      if (mainWindow.isMinimized()) mainWindow.restore();
      mainWindow.show();
      mainWindow.focus();
    }
  });

  app.on('ready', async () => {
    log.info('[main] Aplicação pronta');

    Menu.setApplicationMenu(null);

    registerIpcHandlers();
    setupUpdater();

    createWindow();
    createTray();

    await setupAutoLaunch().catch((err) => {
      log.error('[main] Erro ao configurar auto-launch:', err);
    });

    await checkForUpdates().catch((err) => {
      log.error('[main] Erro ao verificar atualizações:', err);
    });
  });

  app.on('before-quit', () => {
    isQuitting = true;
  });

  app.on('window-all-closed', () => {
    if (process.platform !== 'darwin') {
      app.quit();
    }
  });

  app.on('activate', () => {
    if (mainWindow === null) {
      createWindow();
    } else {
      mainWindow.show();
    }
  });
}

export { updateTrayMenu };
