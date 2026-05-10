import { isAutoLaunchEnabled, toggleAutoLaunch } from '@opensea/satellite-runtime/auto-launch';
import { getLogger } from '@opensea/satellite-runtime/log';
import { checkForUpdates, quitAndInstall } from '@opensea/satellite-runtime/updater';
import { app, BrowserWindow, ipcMain, net } from 'electron';
import { isConnected } from './connection-state';
import { connectWebSocket, disconnectWebSocket } from './main';
import { deleteDeviceToken, setDeviceToken } from './secure-store';
import { type StoreSchema, store } from './store';

const log = getLogger('ipc');

import { cancelJob, getJobs, manageJob } from './job-queue';
import { detectorToCode } from './printer-status';

// ── Rate limiter simples (janela de tempo mínimo entre chamadas) ──────────────
const lastCalled = new Map<string, number>();

function rateLimit(channel: string, minIntervalMs: number): boolean {
  const now = Date.now();
  const last = lastCalled.get(channel) ?? 0;
  if (now - last < minIntervalMs) {
    log.warn(
      `[ipc] Rate limit hit em ${channel} (última há ${now - last}ms, mínimo ${minIntervalMs}ms)`,
    );
    return false;
  }
  lastCalled.set(channel, now);
  return true;
}

// ── Validação de URL da API ───────────────────────────────────────────────────
function isValidApiUrl(url: string): boolean {
  try {
    const parsed = new URL(url);
    if (!['http:', 'https:'].includes(parsed.protocol)) return false;
    if (app.isPackaged && parsed.protocol !== 'https:') {
      // Em produção, só aceita HTTPS
      return false;
    }
    return true;
  } catch {
    return false;
  }
}

// ── Sanitização de strings para log ───────────────────────────────────────────
function safeLog(value: string | null | undefined, maxLen = 64): string {
  if (!value) return '(vazio)';
  return value.replace(/[\r\n\t\x00-\x1f]/g, '_').slice(0, maxLen);
}

// ── Fetch com timeout, CORS explícito e proxy opcional ────────────────────────
interface FetchOptions {
  method: string;
  body?: unknown;
  timeoutMs?: number;
}

async function apiRequest(apiUrl: string, pathname: string, opts: FetchOptions): Promise<Response> {
  if (!isValidApiUrl(apiUrl)) {
    throw new Error(`URL da API inválida: ${safeLog(apiUrl)}`);
  }

  const url = `${apiUrl.replace(/\/+$/, '')}${pathname}`;
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), opts.timeoutMs ?? 15_000);

  try {
    // Electron `net` honra config de proxy corporativo do sistema automaticamente.
    // `net.fetch` está disponível no main process (Electron 28+).
    const fetchFn =
      typeof net !== 'undefined' && typeof net.fetch === 'function' ? net.fetch.bind(net) : fetch;

    const response = await fetchFn(url, {
      method: opts.method,
      mode: 'cors',
      credentials: 'omit',
      cache: 'no-store',
      headers: { 'Content-Type': 'application/json' },
      body: opts.body ? JSON.stringify(opts.body) : undefined,
      signal: controller.signal,
    });
    return response;
  } finally {
    clearTimeout(timeout);
  }
}

function registerIpcHandlers(): void {
  // ── Store ────────────────────────────────────────────────────────────
  ipcMain.handle('store:get', (_event, key: keyof StoreSchema) => {
    try {
      return store.get(key);
    } catch (error) {
      log.error(`[ipc] store:get(${safeLog(String(key))}) erro:`, error);
      return null;
    }
  });

  ipcMain.handle('store:set', (_event, key: keyof StoreSchema, value: unknown) => {
    try {
      store.set(key, value as never);
      return true;
    } catch (error) {
      log.error(`[ipc] store:set(${safeLog(String(key))}) erro:`, error);
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
      return {
        paired: false,
        connected: false,
        computerName: '',
        ipAddress: '',
      };
    }
  });

  ipcMain.handle('agent:pair', async (_event, code: string) => {
    if (!rateLimit('agent:pair', 10_000)) {
      return {
        success: false,
        error: 'Aguarde alguns segundos antes de tentar novamente',
      };
    }
    try {
      if (typeof code !== 'string' || code.length < 4 || code.length > 32) {
        return { success: false, error: 'Código de pareamento inválido' };
      }

      const apiUrl = store.get('apiUrl');
      const hostname = (await import('os')).hostname();
      const codePrefix = code.slice(0, 2);

      log.info(
        `[ipc] Pair attempt — code=${codePrefix}** host=${safeLog(hostname)} at=${new Date().toISOString()}`,
      );

      const response = await apiRequest(apiUrl, '/v1/sales/print-agents/pair', {
        method: 'POST',
        body: { pairingCode: code, hostname },
        timeoutMs: 15_000,
      });

      if (!response.ok) {
        const body = await response.json().catch(() => ({}));
        const message = (body as { message?: string }).message ?? `HTTP ${response.status}`;
        throw new Error(message);
      }

      const data = (await response.json()) as {
        deviceToken: string;
        agentId: string;
        agentName: string;
      };

      await setDeviceToken(data.deviceToken);
      store.set('agentId', data.agentId);
      store.set('agentName', data.agentName);
      store.set('pairingCode', code);

      log.info(`[ipc] Agente pareado: ${safeLog(data.agentName)} (${safeLog(data.agentId, 32)})`);
      await connectWebSocket();
      return {
        success: true,
        agentId: data.agentId,
        agentName: data.agentName,
      };
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Erro desconhecido';
      log.error('[ipc] agent:pair erro:', safeLog(message, 200));
      return { success: false, error: message };
    }
  });

  ipcMain.handle('agent:unpair', async () => {
    try {
      const apiUrl = store.get('apiUrl');
      const agentId = store.get('agentId');

      // 1) Desconectar WS primeiro para evitar race com backend revogando token
      disconnectWebSocket();

      if (agentId) {
        log.info(`[ipc] Despareando agente: ${safeLog(agentId, 32)}`);
        try {
          await apiRequest(apiUrl, `/v1/sales/print-agents/${encodeURIComponent(agentId)}/unpair`, {
            method: 'POST',
            timeoutMs: 10_000,
          });
        } catch (err) {
          log.warn('[ipc] Falha ao notificar API sobre despareamento:', err);
        }
      }

      // 2) Limpar credenciais só depois
      await deleteDeviceToken();
      store.set('agentId', null);
      store.set('agentName', null);
      store.set('pairingCode', null);
      log.info('[ipc] Agente despareado');
      return { success: true };
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Erro desconhecido';
      log.error('[ipc] agent:unpair erro:', safeLog(message, 200));
      return { success: false, error: message };
    }
  });

  // ── Printers ─────────────────────────────────────────────────────────
  ipcMain.handle('printers:list', async () => {
    if (!rateLimit('printers:list', 2_000)) {
      return [];
    }
    try {
      const { detectPrinters } = await import('./printer-detector');
      const printers = await detectPrinters();

      return printers.map((p) => ({
        name: p.name,
        displayName: p.name,
        description: p.type,
        status: detectorToCode(p.status),
        isDefault: p.isDefault,
      }));
    } catch (error) {
      log.error('[ipc] printers:list erro:', error);
      return [];
    }
  });

  // ── Updater ──────────────────────────────────────────────────────────
  ipcMain.handle('updater:check', async () => {
    if (!rateLimit('updater:check', 30_000)) {
      return {
        success: false,
        error: 'Aguarde 30 segundos entre verificações',
      };
    }
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
      return await isAutoLaunchEnabled('OpenSea Print Server');
    } catch (error) {
      log.error('[ipc] auto-launch:is-enabled erro:', error);
      return false;
    }
  });

  ipcMain.handle('auto-launch:toggle', async () => {
    try {
      const newState = await toggleAutoLaunch('OpenSea Print Server', true);
      return { success: true, enabled: newState };
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Erro desconhecido';
      log.error('[ipc] auto-launch:toggle erro:', message);
      return { success: false, error: message };
    }
  });

  // ── Print Queue ──────────────────────────────────────────────────────
  ipcMain.handle('printers:jobs', async (_event, printerName: string) => {
    if (!rateLimit('printers:jobs', 2_000)) {
      return [];
    }
    try {
      if (!printerName || typeof printerName !== 'string') return [];
      return await getJobs(printerName);
    } catch (error) {
      log.error('[ipc] printers:jobs erro:', error);
      return [];
    }
  });

  ipcMain.handle('printers:cancel-job', async (_event, printerName: string, jobId: number) => {
    if (!rateLimit('printers:cancel-job', 1_000)) {
      return { success: false, error: 'Aguarde antes de tentar novamente' };
    }
    try {
      return await cancelJob(printerName, jobId);
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Erro desconhecido';
      log.error('[ipc] printers:cancel-job erro:', message);
      return { success: false, error: message };
    }
  });

  ipcMain.handle(
    'printers:manage-job',
    async (_event, printerName: string, jobId: number, action: string) => {
      if (!rateLimit('printers:manage-job', 1_000)) {
        return { success: false, error: 'Aguarde antes de tentar novamente' };
      }
      try {
        const validActions = ['restart', 'pause', 'resume', 'clear-all'];
        if (!validActions.includes(action)) {
          return { success: false, error: `Ação inválida: ${action}` };
        }
        return await manageJob(
          printerName,
          jobId,
          action as 'restart' | 'pause' | 'resume' | 'clear-all',
        );
      } catch (error) {
        const message = error instanceof Error ? error.message : 'Erro desconhecido';
        log.error('[ipc] printers:manage-job erro:', message);
        return { success: false, error: message };
      }
    },
  );

  // ── App Info ──────────────────────────────────────────────────────────
  ipcMain.handle('app:get-version', () => {
    return app.getVersion();
  });

  log.info('[ipc] Todos os handlers IPC registrados');
}

// BrowserWindow import mantido para compat futura
void BrowserWindow;

export { registerIpcHandlers };
