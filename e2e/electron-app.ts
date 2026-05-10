import path from 'node:path';
import { type ElectronApplication, _electron as electron, type Page } from '@playwright/test';

/**
 * Lança o Electron app para testes E2E.
 * Requer `npm run build` antes de rodar.
 */
export async function launchApp(): Promise<{ app: ElectronApplication; page: Page }> {
  const mainPath = path.resolve(__dirname, '..', 'dist', 'main', 'main.js');

  const app = await electron.launch({
    args: [mainPath],
    env: {
      ...process.env,
      NODE_ENV: 'test',
      // Desabilitar auto-updater em testes
      ELECTRON_NO_UPDATER: '1',
    },
  });

  // Esperar a primeira janela BrowserWindow aparecer
  const page = await app.firstWindow();
  await page.waitForLoadState('domcontentloaded');

  return { app, page };
}
