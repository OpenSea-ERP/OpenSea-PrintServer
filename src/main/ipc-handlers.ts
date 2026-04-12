import { ipcMain, BrowserWindow, app } from 'electron';
import log from 'electron-log';
import { store, StoreSchema } from './store';
import { checkForUpdates, quitAndInstall } from './updater';
import { connectWebSocket, disconnectWebSocket } from './main';
import { isConnected } from './connection-state';
import * as autoLaunch from './auto-launch';

function registerIpcHandlers(): void {
  // ── Store ────────────────────────────────────────────────────────────
  ipcMain.handle('store:get', (_event, key: keyof StoreSchema) => {
    try {
      return store.get(key);
    } catch (error) {
      log.error(`[ipc] store:get(${key}) erro:`, error);
      return null;
    }
  });

  ipcMain.handle('store:set', (_event, key: keyof StoreSchema, value: unknown) => {
    try {
      store.set(key, value as never);
      return true;
    } catch (error) {
      log.error(`[ipc] store:set(${key}) erro:`, error);
      return false;
    }
  });

  // ── Agent ────────────────────────────────────────────────────────────
  ipcMain.handle('agent:get-status', () => {
    try {
      const agentId = store.get('agentId');
      const agentName = store.get('agentName');
      return {
        paired: agentId !== null,
        agentId: agentId ?? undefined,
        computerName: agentName ?? '',
        ipAddress: '',
        connected: isConnected(),
      };
    } catch (error) {
      log.error('[ipc] agent:get-status erro:', error);
      return { paired: false, connected: false, computerName: '', ipAddress: '' };
    }
  });

  ipcMain.handle('agent:pair', async (_event, code: string) => {
    try {
      const apiUrl = store.get('apiUrl');
      log.info(`[ipc] Pareando agente com código: ${code}`);

      const hostname = (await import('os')).hostname();
      const response = await fetch(`${apiUrl}/v1/sales/print-agents/pair`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ pairingCode: code, hostname }),
      });

      if (!response.ok) {
        const body = await response.json().catch(() => ({}));
        const message = (body as { message?: string }).message ?? 'Falha ao parear';
        throw new Error(message);
      }

      const data = (await response.json()) as {
        deviceToken: string;
        agentId: string;
        agentName: string;
      };

      store.set('agentId', data.agentId);
      store.set('agentName', data.agentName);
      store.set('pairingCode', code);
      store.set('deviceToken', data.deviceToken);

      log.info(`[ipc] Agente pareado: ${data.agentName} (${data.agentId})`);
      connectWebSocket();
      return { success: true, agentId: data.agentId, agentName: data.agentName };
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Erro desconhecido';
      log.error('[ipc] agent:pair erro:', message);
      return { success: false, error: message };
    }
  });

  ipcMain.handle('agent:unpair', async () => {
    try {
      const apiUrl = store.get('apiUrl');
      const agentId = store.get('agentId');

      if (agentId) {
        log.info(`[ipc] Despareando agente: ${agentId}`);
        await fetch(`${apiUrl}/v1/sales/print-agents/${agentId}/unpair`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
        }).catch((err) => {
          log.warn('[ipc] Falha ao notificar API sobre despareamento:', err);
        });
      }

      store.set('agentId', null);
      store.set('agentName', null);
      store.set('pairingCode', null);
      store.set('deviceToken', null);

      disconnectWebSocket();
      log.info('[ipc] Agente despareado');
      return { success: true };
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Erro desconhecido';
      log.error('[ipc] agent:unpair erro:', message);
      return { success: false, error: message };
    }
  });

  // ── Printers ─────────────────────────────────────────────────────────
  ipcMain.handle('printers:list', async () => {
    try {
      const { detectPrinters } = await import('./printer-detector');
      const printers = await detectPrinters();

      return printers.map((p) => ({
        name: p.name,
        displayName: p.name,
        description: p.type,
        status: p.status === 'ready' ? 0 : p.status === 'offline' ? 1 : p.status === 'error' ? 2 : 3,
        isDefault: p.isDefault,
      }));
    } catch (error) {
      log.error('[ipc] printers:list erro:', error);
      return [];
    }
  });

  // ── Updater ──────────────────────────────────────────────────────────
  ipcMain.handle('updater:check', async () => {
    try {
      await checkForUpdates();
      return { success: true };
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Erro desconhecido';
      log.error('[ipc] updater:check erro:', message);
      return { success: false, error: message };
    }
  });

  ipcMain.handle('updater:install', () => {
    try {
      quitAndInstall();
      return { success: true };
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Erro desconhecido';
      log.error('[ipc] updater:install erro:', message);
      return { success: false, error: message };
    }
  });

  // ── Auto-Launch ──────────────────────────────────────────────────────
  ipcMain.handle('auto-launch:is-enabled', async () => {
    try {
      return await autoLaunch.isEnabled();
    } catch (error) {
      log.error('[ipc] auto-launch:is-enabled erro:', error);
      return false;
    }
  });

  ipcMain.handle('auto-launch:toggle', async () => {
    try {
      const newState = await autoLaunch.toggle();
      return { success: true, enabled: newState };
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Erro desconhecido';
      log.error('[ipc] auto-launch:toggle erro:', message);
      return { success: false, error: message };
    }
  });

  // ── App Info ──────────────────────────────────────────────────────────
  ipcMain.handle('app:get-version', () => {
    return app.getVersion();
  });

  log.info('[ipc] Todos os handlers IPC registrados');
}

export { registerIpcHandlers };
