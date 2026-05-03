import AutoLaunch from "auto-launch";
import { app } from "electron";
import log from "electron-log";
import { store } from "./store";

const autoLauncher = new AutoLaunch({
  name: "OpenSea Print Server",
  isHidden: true,
});

// Em dev, `process.execPath` aponta para `node_modules/electron/dist/electron.exe`,
// que abriria a welcome screen do Electron a cada boot. Bloqueamos toda operação
// de auto-launch fora do app empacotado para não poluir o registry do dev.
function devGuard(action: string): boolean {
  if (!app.isPackaged) {
    log.warn(
      `[auto-launch] ${action} ignorado em modo dev (app.isPackaged=false)`,
    );
    return true;
  }
  return false;
}

async function isEnabled(): Promise<boolean> {
  if (devGuard("isEnabled")) return false;
  try {
    return await autoLauncher.isEnabled();
  } catch (error) {
    log.error("[auto-launch] Erro ao verificar status:", error);
    return false;
  }
}

async function enable(): Promise<void> {
  if (devGuard("enable")) return;
  try {
    const enabled = await autoLauncher.isEnabled();
    if (!enabled) {
      await autoLauncher.enable();
    }
    store.set("autoLaunch", true);
    log.info("[auto-launch] Inicialização automática ativada");
  } catch (error) {
    log.error("[auto-launch] Erro ao ativar:", error);
    throw error;
  }
}

async function disable(): Promise<void> {
  if (devGuard("disable")) return;
  try {
    const enabled = await autoLauncher.isEnabled();
    if (enabled) {
      await autoLauncher.disable();
    }
    store.set("autoLaunch", false);
    log.info("[auto-launch] Inicialização automática desativada");
  } catch (error) {
    log.error("[auto-launch] Erro ao desativar:", error);
    throw error;
  }
}

async function toggle(): Promise<boolean> {
  if (devGuard("toggle")) return false;
  const enabled = await isEnabled();
  if (enabled) {
    await disable();
  } else {
    await enable();
  }
  return !enabled;
}

async function setup(): Promise<void> {
  if (devGuard("setup")) return;
  const shouldAutoLaunch = store.get("autoLaunch");
  if (shouldAutoLaunch) {
    await enable();
  }
}

export { isEnabled, enable, disable, toggle, setup };
