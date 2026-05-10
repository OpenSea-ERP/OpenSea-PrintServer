import type { ElectronApplication, Page } from '@playwright/test';
import { expect, test } from '@playwright/test';
import { launchApp } from './electron-app';

let app: ElectronApplication;
let page: Page;

test.beforeAll(async () => {
  const result = await launchApp();
  app = result.app;
  page = result.page;
  await page.waitForTimeout(1500);
});

test.afterAll(async () => {
  if (app) await app.close();
});

// ── Segurança IPC — whitelist de canais ────────────────────────────────────

test('invoke em canal permitido (app:get-version) funciona', async () => {
  const version = await page.evaluate(async () => {
    return window.electronAPI.invoke('app:get-version');
  });
  expect(typeof version).toBe('string');
  expect(version).toMatch(/^\d+\.\d+\.\d+/);
});

test('invoke em canal não permitido lança erro', async () => {
  const result = await page.evaluate(async () => {
    try {
      await window.electronAPI.invoke('shell:exec', 'whoami');
      return { error: null };
    } catch (e: unknown) {
      return { error: (e as Error).message };
    }
  });
  expect(result.error).toContain('não permitido');
});

test('invoke em canal fs:read lança erro', async () => {
  const result = await page.evaluate(async () => {
    try {
      await window.electronAPI.invoke('fs:read', '/etc/passwd');
      return { error: null };
    } catch (e: unknown) {
      return { error: (e as Error).message };
    }
  });
  expect(result.error).toContain('não permitido');
});

test('invoke vazio lança erro', async () => {
  const result = await page.evaluate(async () => {
    try {
      await window.electronAPI.invoke('');
      return { error: null };
    } catch (e: unknown) {
      return { error: (e as Error).message };
    }
  });
  expect(result.error).toContain('não permitido');
});

test('on em canal de evento permitido (connection:status) não lança', async () => {
  const result = await page.evaluate(() => {
    try {
      const unsub = window.electronAPI.on('connection:status', () => {});
      unsub();
      return { error: null };
    } catch (e: unknown) {
      return { error: (e as Error).message };
    }
  });
  expect(result.error).toBeNull();
});

test('on em canal de evento não permitido lança erro', async () => {
  const result = await page.evaluate(() => {
    try {
      window.electronAPI.on('arbitrary:event', () => {});
      return { error: null };
    } catch (e: unknown) {
      return { error: (e as Error).message };
    }
  });
  expect(result.error).toContain('não permitido');
});

// ── IPC funcional ──────────────────────────────────────────────────────────

test('store:get retorna valor válido para apiUrl', async () => {
  const apiUrl = await page.evaluate(async () => {
    return window.electronAPI.invoke('store:get', 'apiUrl');
  });
  expect(typeof apiUrl).toBe('string');
  expect(apiUrl).toContain('http');
});

test('agent:get-status retorna objeto com paired e connected', async () => {
  const status = await page.evaluate(async () => {
    return window.electronAPI.invoke('agent:get-status');
  });
  expect(status).toHaveProperty('paired');
  expect(status).toHaveProperty('connected');
  expect(typeof (status as { paired: boolean }).paired).toBe('boolean');
});

test('printers:list retorna array', async () => {
  const printers = await page.evaluate(async () => {
    return window.electronAPI.invoke('printers:list');
  });
  expect(Array.isArray(printers)).toBe(true);
});

test('cada impressora tem name, status, isDefault', async () => {
  const printers = await page.evaluate(async () => {
    return window.electronAPI.invoke<Array<{ name: string; status: number; isDefault: boolean }>>(
      'printers:list',
    );
  });
  if ((printers as unknown[]).length === 0) {
    test.skip(); // Nenhuma impressora no sistema
    return;
  }
  for (const p of printers as Array<{ name: string; status: number; isDefault: boolean }>) {
    expect(typeof p.name).toBe('string');
    expect(typeof p.status).toBe('number');
    expect(typeof p.isDefault).toBe('boolean');
  }
});

test('printers:jobs retorna array (mesmo vazio)', async () => {
  const jobs = await page.evaluate(async () => {
    return window.electronAPI.invoke('printers:jobs', 'NonExistentPrinter');
  });
  expect(Array.isArray(jobs)).toBe(true);
});
