/**
 * Preload Script
 * Exposes safe IPC methods to the renderer via contextBridge.
 * Canais são filtrados por whitelist — renderer não pode invocar canais arbitrários.
 */

import { contextBridge, ipcRenderer } from 'electron';

const INVOKE_CHANNELS = new Set<string>([
  'store:get',
  'store:set',
  'agent:get-status',
  'agent:pair',
  'agent:unpair',
  'printers:list',
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
    const handler = (_event: Electron.IpcRendererEvent, ...args: unknown[]) =>
      callback(...args);
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
    const handler = (_event: Electron.IpcRendererEvent, status: unknown) =>
      callback(status);
    ipcRenderer.on('updater:status', handler);
    return () => ipcRenderer.removeListener('updater:status', handler);
  },

  onConnectionStatus: (callback: (status: string) => void) => {
    const handler = (_event: Electron.IpcRendererEvent, status: string) =>
      callback(status);
    ipcRenderer.on('connection:status', handler);
    return () => ipcRenderer.removeListener('connection:status', handler);
  },

  getVersion: () => ipcRenderer.invoke('app:get-version'),
});
