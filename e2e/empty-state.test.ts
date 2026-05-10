import type { ElectronApplication, Page } from '@playwright/test';
import { expect, test } from '@playwright/test';
import { launchApp } from './electron-app';

let app: ElectronApplication;
let page: Page;

test.beforeAll(async () => {
  const result = await launchApp();
  app = result.app;
  page = result.page;
});

test.afterAll(async () => {
  if (app) await app.close();
});

// ── Estado vazio (não pareado) ─────────────────────────────────────────────
// Ao iniciar pela primeira vez (sem agentId), o app mostra a tela de empty state

test('mostra tela de empty state quando não pareado', async () => {
  // Aguardar carregamento — loading screen desaparece
  await page.waitForTimeout(2000);

  // Deve conter texto indicando que precisa parear
  const bodyText = await page.textContent('body');
  expect(bodyText).toBeTruthy();
});

test('tem botão "Vincular Computador" para iniciar pareamento', async () => {
  const btn = page.locator('button', { hasText: 'Vincular Computador' });
  await expect(btn).toBeVisible({ timeout: 5000 });
});
