import { test, expect } from '@playwright/test';
import { launchApp } from './electron-app';
import type { ElectronApplication, Page } from '@playwright/test';

let app: ElectronApplication;
let page: Page;

test.beforeAll(async () => {
  const result = await launchApp();
  app = result.app;
  page = result.page;
  // Aguardar preload + React hydration
  await page.waitForTimeout(2000);
});

test.afterAll(async () => {
  if (app) await app.close();
});

// ── Inicialização ──────────────────────────────────────────────────────────

test('app inicia e janela principal é exibida', async () => {
  expect(page).toBeTruthy();
  const title = await page.title();
  // Electron pode ter título vazio ou do index.html
  expect(typeof title).toBe('string');
});

test('janela tem dimensões corretas (440x680)', async () => {
  const bounds = await app.evaluate(async ({ BrowserWindow }) => {
    const win = BrowserWindow.getAllWindows()[0];
    if (!win) return null;
    const { width, height } = win.getBounds();
    return { width, height };
  });
  expect(bounds).not.toBeNull();
  expect(bounds!.width).toBe(440);
  expect(bounds!.height).toBe(680);
});

test('janela não é redimensionável', async () => {
  const resizable = await app.evaluate(async ({ BrowserWindow }) => {
    const win = BrowserWindow.getAllWindows()[0];
    return win?.isResizable() ?? true;
  });
  expect(resizable).toBe(false);
});

test('contextIsolation está ativado', async () => {
  const contextIsolation = await app.evaluate(async ({ BrowserWindow }) => {
    const win = BrowserWindow.getAllWindows()[0];
    return win?.webContents.getLastWebPreferences()?.contextIsolation;
  });
  expect(contextIsolation).toBe(true);
});

test('nodeIntegration está desativado', async () => {
  const nodeIntegration = await app.evaluate(async ({ BrowserWindow }) => {
    const win = BrowserWindow.getAllWindows()[0];
    return win?.webContents.getLastWebPreferences()?.nodeIntegration;
  });
  expect(nodeIntegration).toBe(false);
});

test('electronAPI está exposta no renderer', async () => {
  const hasApi = await page.evaluate(() => {
    return typeof window.electronAPI !== 'undefined';
  });
  expect(hasApi).toBe(true);
});

test('electronAPI.invoke existe', async () => {
  const hasInvoke = await page.evaluate(() => {
    return typeof window.electronAPI?.invoke === 'function';
  });
  expect(hasInvoke).toBe(true);
});

test('electronAPI.on existe', async () => {
  const hasOn = await page.evaluate(() => {
    return typeof window.electronAPI?.on === 'function';
  });
  expect(hasOn).toBe(true);
});
