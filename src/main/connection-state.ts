/**
 * Shared connection state — avoids circular dependency between main.ts and ipc-handlers.ts
 */

let connected = false;

export function setConnected(value: boolean): void {
  connected = value;
}

export function isConnected(): boolean {
  return connected;
}
