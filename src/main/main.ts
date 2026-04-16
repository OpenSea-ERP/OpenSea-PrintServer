import { app, BrowserWindow, Tray, Menu, nativeImage } from 'electron';
import path from 'path';
import log from 'electron-log';
import { registerIpcHandlers } from './ipc-handlers';
import { setupUpdater, checkForUpdates } from './updater';
import { setup as setupAutoLaunch } from './auto-launch';
import { store } from './store';
import { PrintServerWSClient } from './ws-client';
import { setConnected } from './connection-state';
import { getDeviceToken } from './secure-store';

log.transports.file.level = 'info';
log.transports.console.level = 'debug';

let mainWindow: BrowserWindow | null = null;
let tray: Tray | null = null;
let isQuitting = false;
const wsClient = new PrintServerWSClient();

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
  const apiUrl = store.get('apiUrl');
  if (!deviceToken) {
    log.info('[main] Sem deviceToken, WebSocket não conectado');
    return;
  }

  const wsUrl = apiUrl.replace(/^http/, 'ws');
  log.info(`[main] Conectando WebSocket: ${wsUrl}`);
  wsClient.connect(wsUrl, deviceToken);
}

function disconnectWebSocket(): void {
  wsClient.disconnect();
}

// Track connection state and send to renderer
wsClient.on('state', (state: string) => {
  const isOnline = state === 'connected';
  setConnected(isOnline);
  sendToRenderer('connection:status', isOnline ? 'connected' : 'disconnected');
  updateTrayMenu(isOnline);

  // Send printer list to backend on connect
  if (isOnline) {
    sendPrintersToBackend();
  }
});

// Handle incoming commands from backend
wsClient.onMessage((message) => {
  if (message.type === 'request-printers') {
    sendPrintersToBackend();
  }
  // TODO: handle 'print' commands
});

async function sendPrintersToBackend(): Promise<void> {
  try {
    const { detectPrinters } = await import('./printer-detector');
    const detected = await detectPrinters();

    const printers = detected.map((p) => ({
      name: p.name,
      type: p.type,
      isDefault: p.isDefault,
      status: (p.status === 'ready' ? 'ONLINE' : p.status === 'offline' ? 'OFFLINE' : p.status === 'error' ? 'ERROR' : 'UNKNOWN') as 'ONLINE' | 'OFFLINE' | 'ERROR',
    }));

    wsClient.send({ type: 'printers', printers: printers as any });
    log.info(`[main] Enviadas ${printers.length} impressoras ao backend`);
  } catch (err) {
    log.error('[main] Erro ao enviar impressoras:', err);
  }
}

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

    // Connect WebSocket if already paired
    await connectWebSocket().catch((err) => {
      log.error('[main] Erro ao conectar WebSocket inicial:', err);
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

export { updateTrayMenu, connectWebSocket, disconnectWebSocket };
