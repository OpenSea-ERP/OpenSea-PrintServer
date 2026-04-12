import AutoLaunch from 'auto-launch';
import log from 'electron-log';
import { store } from './store';

const autoLauncher = new AutoLaunch({
  name: 'OpenSea Print Server',
  isHidden: true,
});

async function isEnabled(): Promise<boolean> {
  try {
    return await autoLauncher.isEnabled();
  } catch (error) {
    log.error('[auto-launch] Erro ao verificar status:', error);
    return false;
  }
}

async function enable(): Promise<void> {
  try {
    const enabled = await autoLauncher.isEnabled();
    if (!enabled) {
      await autoLauncher.enable();
    }
    store.set('autoLaunch', true);
    log.info('[auto-launch] Inicialização automática ativada');
  } catch (error) {
    log.error('[auto-launch] Erro ao ativar:', error);
    throw error;
  }
}

async function disable(): Promise<void> {
  try {
    const enabled = await autoLauncher.isEnabled();
    if (enabled) {
      await autoLauncher.disable();
    }
    store.set('autoLaunch', false);
    log.info('[auto-launch] Inicialização automática desativada');
  } catch (error) {
    log.error('[auto-launch] Erro ao desativar:', error);
    throw error;
  }
}

async function toggle(): Promise<boolean> {
  const enabled = await isEnabled();
  if (enabled) {
    await disable();
  } else {
    await enable();
  }
  return !enabled;
}

async function setup(): Promise<void> {
  const shouldAutoLaunch = store.get('autoLaunch');
  if (shouldAutoLaunch) {
    await enable();
  }
}

export { isEnabled, enable, disable, toggle, setup };
