export interface PrinterInfo {
  name: string;
  displayName: string;
  description: string;
  status: number;
  isDefault: boolean;
  options?: Record<string, string>;
}

export interface PrintJob {
  id: number;
  documentName: string;
  userName: string;
  submittedAt: string;
  status: 'printing' | 'queued' | 'paused' | 'error' | 'deleting';
  totalPages: number;
  pagesPrinted: number;
  sizeBytes: number;
}

export interface AgentStatus {
  paired: boolean;
  agentId?: string;
  computerName?: string;
  ipAddress?: string;
  pairedAt?: string;
  connected: boolean;
  serverUrl?: string;
}

export interface PairingResult {
  success: boolean;
  error?: string;
  agentId?: string;
  computerName?: string;
}

export interface AppSettings {
  autoLaunch: boolean;
  minimizeToTray: boolean;
}

export interface UpdateStatus {
  status: 'checking' | 'available' | 'not-available' | 'downloading' | 'downloaded' | 'error';
  version?: string;
  error?: string;
  progress?: number;
}

import type { WindowApi } from '@opensea/satellite-ui';

export interface ElectronAPI {
  invoke: <T = unknown>(channel: string, ...args: unknown[]) => Promise<T>;
  on: (channel: string, callback: (...args: unknown[]) => void) => () => void;
  getVersion: () => string;
}

declare global {
  interface Window {
    electronAPI: ElectronAPI;
    /** Bridge para o AppWindow do @opensea/satellite-ui. */
    windowApi: WindowApi;
  }
}
