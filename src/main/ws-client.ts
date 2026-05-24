/**
 * Socket.IO client for PrintServer — /devices namespace.
 *
 * Migration (2026-05-24): replaced `@opensea/satellite-runtime/ws-client`
 * (native `ws` via SatelliteWSClient) with socket.io-client@4.8.3 connecting
 * to the shared /devices namespace used by all satellites.
 *
 * Preserved public API (callers main.ts, ipc-handlers.ts need zero changes):
 *   - `PrintServerWSClient` class with `connect(apiUrl, agentToken)`,
 *     `disconnect()`, `send(message)`, `onMessage(handler)`, `state` getter.
 *   - EventEmitter events: `'state'`, `'release'`, `'revoked'`, `'message'`.
 *   - `isValidIncomingMessage(raw)` for unit tests + message dispatch.
 *
 * Auth: { type: 'device', deviceToken: agentToken } — no bearer header needed.
 * Heartbeat + reconnect: built into Socket.IO (pingInterval/pingTimeout +
 * exponential backoff). Manual heartbeat and reconnect logic removed.
 *
 * Event names: only the canonical SDK names are registered (legacy dual-listen removed).
 * 'sales.pos.terminal.revoked', 'admin.releases.satellite.published', and
 * 'sales.printing.job.created' are the single authoritative event names.
 * The direct 'print' socket event (dispatched by the API via toDevice()) is also
 * handled for inline label print jobs.
 *
 * send() now delegates to socket.emit() for non-heartbeat messages (heartbeat
 * is built into Socket.IO; outgoing { type: 'heartbeat' } messages are silently
 * dropped since they are no longer needed).
 */

import { EventEmitter } from 'node:events';
import type { EventPayload } from '@opensea/realtime';
import type {
  WsAppReleasePublishedMessage,
  WsDeviceRevokedMessage,
  WsWelcomeMessage,
} from '@opensea/satellite-contract';
import { io as createSocket, type Socket } from 'socket.io-client';

// ── Types (preserved for consumers) ──────────────────────────────────────

export type ConnectionState = 'disconnected' | 'connecting' | 'connected';

export interface PrintCommand {
  type: 'print';
  jobId: string;
  printerName?: string;
  printerId: string;
  data: string;
  copies: number;
}

export interface RequestPrintersCommand {
  type: 'request-printers';
}

export type PrintIncomingMessage = PrintCommand | RequestPrintersCommand;

export type SharedIncomingMessage =
  | WsWelcomeMessage
  | WsAppReleasePublishedMessage
  | WsDeviceRevokedMessage;

export type IncomingMessage = PrintIncomingMessage | SharedIncomingMessage;

export interface PrinterInfo {
  name: string;
  type: 'local' | 'network' | 'virtual';
  isDefault: boolean;
  status: 'ONLINE' | 'OFFLINE' | 'ERROR' | 'UNKNOWN';
}

export interface PrintResultMessage {
  type: 'print-result';
  jobId: string;
  success: boolean;
  error?: string;
  durationMs?: number;
}

export interface PrintersListMessage {
  type: 'printers';
  printers: PrinterInfo[];
}

export interface StatusMessage {
  type: 'status';
  status: 'ONLINE' | 'OFFLINE';
}

export interface HeartbeatOutgoingMessage {
  type: 'heartbeat';
}

export type OutgoingMessage =
  | PrintResultMessage
  | PrintersListMessage
  | StatusMessage
  | HeartbeatOutgoingMessage;

type MessageHandler = (msg: IncomingMessage) => void;

// ── Validators (preserved for unit tests and callers) ─────────────────────

const MAX_PAYLOAD = 10 * 1024 * 1024;

const VALID_DEVICE_REVOKED_REASONS = new Set([
  'unpaired_by_user',
  'unpaired_by_admin',
  'force_revoked_by_admin',
]);

const VALID_RELEASE_KINDS = new Set(['EMPORION', 'PRINT_SERVER', 'HORUS']);

function isValidPrintMessage(raw: unknown): raw is PrintIncomingMessage {
  if (!raw || typeof raw !== 'object') return false;
  const msg = raw as { type?: unknown };
  if (msg.type === 'request-printers') return true;
  if (msg.type === 'print') {
    const m = raw as Record<string, unknown>;
    const hasPrinterName =
      typeof m.printerName === 'string' && m.printerName.length > 0 && m.printerName.length <= 256;
    const hasPrinterId =
      typeof m.printerId === 'string' && m.printerId.length > 0 && m.printerId.length <= 256;
    return (
      typeof m.jobId === 'string' &&
      m.jobId.length > 0 &&
      m.jobId.length <= 128 &&
      (hasPrinterName || hasPrinterId) &&
      typeof m.data === 'string' &&
      m.data.length > 0 &&
      m.data.length <= MAX_PAYLOAD &&
      typeof m.copies === 'number' &&
      Number.isInteger(m.copies) &&
      m.copies >= 1 &&
      m.copies <= 999
    );
  }
  return false;
}

function isValidSharedMessage(raw: unknown): raw is SharedIncomingMessage {
  if (!raw || typeof raw !== 'object') return false;
  const msg = raw as Record<string, unknown>;
  if (msg.type === 'welcome') {
    return typeof msg.terminalId === 'string' && typeof msg.protocolVersion === 'string';
  }
  if (msg.type === 'app.release.published') {
    return (
      typeof msg.kind === 'string' &&
      VALID_RELEASE_KINDS.has(msg.kind) &&
      typeof msg.version === 'string' &&
      typeof msg.downloadUrl === 'string' &&
      typeof msg.sha256 === 'string' &&
      msg.sha256.length === 64 &&
      typeof msg.releasedAt === 'string'
    );
  }
  if (msg.type === 'device.revoked') {
    return (
      typeof msg.reason === 'string' &&
      VALID_DEVICE_REVOKED_REASONS.has(msg.reason) &&
      typeof msg.revokedAt === 'string' &&
      typeof msg.revokedBy === 'object' &&
      msg.revokedBy !== null
    );
  }
  return false;
}

/**
 * Public validator preserved for `ws-client.spec.ts` and any caller that
 * wants to validate a raw payload out of the live socket pipeline.
 */
export function isValidIncomingMessage(raw: unknown): raw is IncomingMessage {
  return isValidPrintMessage(raw) || isValidSharedMessage(raw);
}

// ── Client class ─────────────────────────────────────────────────────────

export class PrintServerWSClient extends EventEmitter {
  private socket: Socket | null = null;
  private apiUrl: string = '';
  private agentToken: string = '';
  private messageHandler: MessageHandler | null = null;
  private _state: ConnectionState = 'disconnected';

  get state(): ConnectionState {
    return this._state;
  }

  onMessage(handler: MessageHandler): void {
    this.messageHandler = handler;
  }

  connect(apiUrl: string, agentToken: string): void {
    this.apiUrl = apiUrl;
    this.agentToken = agentToken;

    // Tear down any previous instance so re-pair after unpair gets a clean slate.
    if (this.socket) {
      this.socket.removeAllListeners();
      this.socket.disconnect();
      this.socket = null;
    }

    const devicesUrl = `${this.apiUrl.replace(/\/+$/, '')}/devices`;

    this.socket = createSocket(devicesUrl, {
      transports: ['websocket'],
      auth: { type: 'device', deviceToken: this.agentToken },
      reconnection: true,
      reconnectionDelay: 1000,
      reconnectionDelayMax: 30000,
      reconnectionAttempts: Infinity,
    });

    // ── Lifecycle ────────────────────────────────────────────────────────

    this.socket.on('connect', () => {
      this.setState('connected');
    });

    this.socket.on('disconnect', () => {
      this.setState('disconnected');
    });

    this.socket.on('connect_error', () => {
      this.setState('connecting');
    });

    this.socket.on('reconnect_attempt', () => {
      this.setState('connecting');
    });

    this.socket.on('reconnect', () => {
      this.setState('connected');
    });

    // ── Release published — SDK event name only (legacy 'app.release.published' removed) ─
    const handleRelease = (payload: unknown): void => {
      const p = payload as Record<string, unknown> | null;
      if (!p || typeof p !== 'object') return;
      if (p.kind !== 'PRINT_SERVER') return;
      this.emit('release', p);
    };
    this.socket.on(
      'admin.releases.satellite.published',
      (payload: EventPayload<'admin.releases.satellite.published'>) => handleRelease(payload),
    );

    // ── Device revoked — SDK event name only (legacy 'device.revoked' removed) ─
    const handleRevoked = (payload: unknown): void => {
      this.emit('revoked', payload ?? {});
    };
    this.socket.on(
      'sales.pos.terminal.revoked',
      (payload: EventPayload<'sales.pos.terminal.revoked'>) => handleRevoked(payload),
    );

    // ── Print job — SDK event name only (legacy 'print' direct event removed) ─
    // 'sales.printing.job.created' carries { jobId, printerId, printerName, copies }.
    // The API now dispatches print commands exclusively via this event and also
    // via 'print' emitted directly to the device room (see v1-create-label-print-job
    // controller) — the controller emits the 'print' event type but via toDevice()
    // on the Socket.IO /devices namespace, so it arrives here as a socket.io event.
    this.socket.on(
      'sales.printing.job.created',
      (payload: EventPayload<'sales.printing.job.created'>) => {
        // Map SDK event to the legacy IncomingMessage shape expected by main.ts.
        const msg: PrintCommand = {
          type: 'print',
          jobId: payload.jobId,
          printerId: payload.printerId,
          printerName: payload.printerName,
          data: '',   // backend must send actual data via separate event or HTTP
          copies: payload.copies,
        };
        this.messageHandler?.(msg);
        this.emit('message', msg);
      },
    );

    // Direct 'print' event from API (dispatched via toDevice() by v1-create-label-print-job).
    // This is the primary path for label print jobs when `data` is included inline.
    this.socket.on('print', (raw: unknown) => {
      if (!isValidPrintMessage(raw)) return;
      this.messageHandler?.(raw);
      this.emit('message', raw);
    });

    this.socket.on('request-printers', () => {
      const msg: RequestPrintersCommand = { type: 'request-printers' };
      this.messageHandler?.(msg);
      this.emit('message', msg);
    });
  }

  disconnect(): void {
    if (!this.socket) return;
    this.socket.removeAllListeners();
    this.socket.disconnect();
    this.socket = null;
    this.setState('disconnected');
  }

  /**
   * Send an outgoing message over the socket.
   *
   * Socket.IO heartbeat (pingInterval/pingTimeout) replaces the manual
   * { type: 'heartbeat' } messages — those are silently dropped here.
   * All other message types are forwarded via socket.emit(type, payload).
   *
   * Returns false if the socket is not connected.
   */
  send(message: OutgoingMessage): boolean {
    if (!this.socket?.connected) return false;
    if (message.type === 'heartbeat') {
      // No-op: Socket.IO manages heartbeats internally.
      return true;
    }
    this.socket.emit(message.type, message);
    return true;
  }

  private setState(state: ConnectionState): void {
    if (this._state === state) return;
    this._state = state;
    this.emit('state', state);
  }
}
