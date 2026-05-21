/**
 * Preload Script
 * Exposes safe IPC methods to the renderer via contextBridge.
 * Canais são filtrados por whitelist — renderer não pode invocar canais arbitrários.
 */

import { contextBridge, ipcRenderer } from 'electron';
import type { WindowApi } from '@opensea/satellite-ui';

const INVOKE_CHANNELS = new Set<string>([
  'store:get',
  'store:set',
  'agent:get-status',
  'agent:pair',
  'agent:unpair',
  'printers:list',
  'printers:jobs',
  'printers:cancel-job',
  'printers:manage-job',
  'updater:check',
  'updater:install',
  'auto-launch:is-enabled',
  'auto-launch:toggle',
  'app:get-version',
]);

const EVENT_CHANNELS = new Set<string>([
  'updater:status',
  'updater:manual-check',
  'connection:status',
  'print:result',
  // Backend used the Satellite Contract `device.revoked` channel to
  // notify us our pairing was killed. The main process forwards it via
  // webContents.send so the renderer can flip back to the pair page
  // without waiting for the next reconnect attempt to surface the 4003
  // close code visibly.
  'device:revoked',
  // Emitted by main when BrowserWindow maximizes/restores.
  // Consumed by AppWindow from @opensea/satellite-ui via `windowApi.onMaximizedChange`.
  'window:maximized-change',
]);

function assertInvoke(channel: string): void {
  if (!INVOKE_CHANNELS.has(channel)) {
    throw new Error(`IPC invoke não permitido no canal: ${channel}`);
  }
}

function assertEvent(channel: string): void {
  if (!EVENT_CHANNELS.has(channel)) {
    throw new Error(`IPC subscribe não permitido no canal: ${channel}`);
  }
}

contextBridge.exposeInMainWorld('electronAPI', {
  invoke: (channel: string, ...args: unknown[]) => {
    assertInvoke(channel);
    return ipcRenderer.invoke(channel, ...args);
  },

  on: (channel: string, callback: (...args: unknown[]) => void) => {
    assertEvent(channel);
    const handler = (_event: Electron.IpcRendererEvent, ...args: unknown[]) => callback(...args);
    ipcRenderer.on(channel, handler);
    return () => ipcRenderer.removeListener(channel, handler);
  },

  getStore: (key: string) => {
    assertInvoke('store:get');
    return ipcRenderer.invoke('store:get', key);
  },
  setStore: (key: string, value: unknown) => {
    assertInvoke('store:set');
    return ipcRenderer.invoke('store:set', key, value);
  },

  getAgentStatus: () => ipcRenderer.invoke('agent:get-status'),
  pairAgent: (code: string) => ipcRenderer.invoke('agent:pair', code),
  unpairAgent: () => ipcRenderer.invoke('agent:unpair'),

  listPrinters: () => ipcRenderer.invoke('printers:list'),

  checkForUpdates: () => ipcRenderer.invoke('updater:check'),
  installUpdate: () => ipcRenderer.invoke('updater:install'),

  isAutoLaunchEnabled: () => ipcRenderer.invoke('auto-launch:is-enabled'),
  toggleAutoLaunch: () => ipcRenderer.invoke('auto-launch:toggle'),

  onUpdateStatus: (callback: (status: unknown) => void) => {
    const handler = (_event: Electron.IpcRendererEvent, status: unknown) => callback(status);
    ipcRenderer.on('updater:status', handler);
    return () => ipcRenderer.removeListener('updater:status', handler);
  },

  onConnectionStatus: (callback: (status: string) => void) => {
    const handler = (_event: Electron.IpcRendererEvent, status: string) => callback(status);
    ipcRenderer.on('connection:status', handler);
    return () => ipcRenderer.removeListener('connection:status', handler);
  },

  onDeviceRevoked: (callback: (payload: { reason: string }) => void) => {
    const handler = (_event: Electron.IpcRendererEvent, payload: { reason: string }) =>
      callback(payload);
    ipcRenderer.on('device:revoked', handler);
    return () => ipcRenderer.removeListener('device:revoked', handler);
  },

  getVersion: () => ipcRenderer.invoke('app:get-version'),
});

// ─── WindowApi — bridge para o AppWindow do @opensea/satellite-ui ─────────
// Exposto separadamente do `window.electronAPI` para satisfazer o contrato
// `WindowApi` do satellite-ui. Os handlers IPC correspondentes estão em
// ipc-handlers.ts (window:minimize/toggle-maximize/close).
const windowApi: WindowApi = {
  minimize: () => {
    ipcRenderer.invoke('window:minimize');
  },
  maximize: () => {
    ipcRenderer.invoke('window:toggle-maximize');
  },
  close: () => {
    ipcRenderer.invoke('window:close');
  },
  onMaximizedChange: (cb) => {
    const listener = (_e: Electron.IpcRendererEvent, maximized: boolean) => cb(maximized);
    ipcRenderer.on('window:maximized-change', listener);
    return () => ipcRenderer.removeListener('window:maximized-change', listener);
  },
};
contextBridge.exposeInMainWorld('windowApi', windowApi);
