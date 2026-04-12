/**
 * Preload Script
 * Exposes safe IPC methods to the renderer via contextBridge
 */

import { contextBridge, ipcRenderer } from 'electron';

contextBridge.exposeInMainWorld('electronAPI', {
  // Generic invoke (used by useIpc hook)
  invoke: (channel: string, ...args: unknown[]) =>
    ipcRenderer.invoke(channel, ...args),

  // Generic event listener (used by useIpcEvent hook)
  on: (channel: string, callback: (...args: unknown[]) => void) => {
    const handler = (_event: Electron.IpcRendererEvent, ...args: unknown[]) =>
      callback(...args);
    ipcRenderer.on(channel, handler);
    return () => ipcRenderer.removeListener(channel, handler);
  },

  // Store
  getStore: (key: string) => ipcRenderer.invoke('store:get', key),
  setStore: (key: string, value: unknown) =>
    ipcRenderer.invoke('store:set', key, value),

  // Agent
  getAgentStatus: () => ipcRenderer.invoke('agent:get-status'),
  pairAgent: (code: string) => ipcRenderer.invoke('agent:pair', code),
  unpairAgent: () => ipcRenderer.invoke('agent:unpair'),

  // Printers
  listPrinters: () => ipcRenderer.invoke('printers:list'),

  // Updater
  checkForUpdates: () => ipcRenderer.invoke('updater:check'),
  installUpdate: () => ipcRenderer.invoke('updater:install'),

  // Auto-launch
  isAutoLaunchEnabled: () => ipcRenderer.invoke('auto-launch:is-enabled'),
  toggleAutoLaunch: () => ipcRenderer.invoke('auto-launch:toggle'),

  // Event listeners
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

  // App info
  getVersion: () => ipcRenderer.invoke('app:get-version'),
});
