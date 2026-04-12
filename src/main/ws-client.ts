import WebSocket from 'ws';
import { EventEmitter } from 'events';
import log from 'electron-log';

// ── Types ────────────────────────────────────────────────────────────────────

export type ConnectionState = 'disconnected' | 'connecting' | 'connected';

export interface PrintCommand {
  type: 'print';
  jobId: string;
  printerId: string;
  data: string; // base64-encoded
  copies: number;
}

export interface RequestPrintersCommand {
  type: 'request-printers';
}

export type IncomingMessage = PrintCommand | RequestPrintersCommand;

export interface PrinterInfo {
  name: string;
  type: 'local' | 'network' | 'virtual';
  isDefault: boolean;
  status: 'ready' | 'offline' | 'error' | 'unknown';
}

export interface PrintResultMessage {
  type: 'print-result';
  jobId: string;
  success: boolean;
  error?: string;
}

export interface PrintersMessage {
  type: 'printers';
  printers: PrinterInfo[];
}

export interface HeartbeatMessage {
  type: 'heartbeat';
}

export interface StatusMessage {
  type: 'status';
  status: 'ONLINE' | 'OFFLINE';
}

export type OutgoingMessage =
  | HeartbeatMessage
  | PrintersMessage
  | PrintResultMessage
  | StatusMessage;

type MessageHandler = (message: IncomingMessage) => void;

// ── Constants ────────────────────────────────────────────────────────────────

const INITIAL_RECONNECT_DELAY = 1000;
const MAX_RECONNECT_DELAY = 30000;
const HEARTBEAT_INTERVAL = 25000;

// ── WebSocket Client ─────────────────────────────────────────────────────────

export class PrintServerWSClient extends EventEmitter {
  private ws: WebSocket | null = null;
  private apiUrl: string = '';
  private agentToken: string = '';
  private reconnectDelay: number = INITIAL_RECONNECT_DELAY;
  private reconnectTimer: ReturnType<typeof setTimeout> | null = null;
  private heartbeatTimer: ReturnType<typeof setInterval> | null = null;
  private messageHandler: MessageHandler | null = null;
  private intentionalDisconnect: boolean = false;
  private _state: ConnectionState = 'disconnected';

  get state(): ConnectionState {
    return this._state;
  }

  private setState(state: ConnectionState): void {
    if (this._state === state) return;
    this._state = state;
    this.emit('state', state);
    log.info(`[WS] Connection state: ${state}`);
  }

  /**
   * Register a handler for incoming messages (print commands, printer requests).
   */
  onMessage(handler: MessageHandler): void {
    this.messageHandler = handler;
  }

  /**
   * Connect to the OpenSea API WebSocket endpoint.
   */
  connect(apiUrl: string, agentToken: string): void {
    this.apiUrl = apiUrl;
    this.agentToken = agentToken;
    this.intentionalDisconnect = false;
    this.reconnectDelay = INITIAL_RECONNECT_DELAY;

    this.doConnect();
  }

  /**
   * Gracefully disconnect and stop reconnection attempts.
   */
  disconnect(): void {
    this.intentionalDisconnect = true;
    this.clearTimers();

    if (this.ws) {
      try {
        this.ws.close(1000, 'Client disconnecting');
      } catch {
        // Already closed
      }
      this.ws = null;
    }

    this.setState('disconnected');
  }

  /**
   * Send a message to the server.
   */
  send(message: OutgoingMessage): boolean {
    if (!this.ws || this.ws.readyState !== WebSocket.OPEN) {
      log.warn('[WS] Cannot send message — not connected');
      return false;
    }

    try {
      this.ws.send(JSON.stringify(message));
      return true;
    } catch (err) {
      log.error('[WS] Failed to send message:', err);
      return false;
    }
  }

  // ── Private ──────────────────────────────────────────────────────────────

  private doConnect(): void {
    this.clearTimers();

    if (this.ws) {
      try {
        this.ws.close();
      } catch {
        // Ignore
      }
      this.ws = null;
    }

    const wsProtocol = this.apiUrl.startsWith('https') ? 'wss' : 'ws';
    const baseUrl = this.apiUrl.replace(/^https?/, wsProtocol).replace(/\/+$/, '');
    const url = `${baseUrl}/v1/ws/print-agent?token=${encodeURIComponent(this.agentToken)}`;

    this.setState('connecting');
    log.info(`[WS] Connecting to ${baseUrl}/v1/ws/print-agent`);

    try {
      this.ws = new WebSocket(url);
    } catch (err) {
      log.error('[WS] Failed to create WebSocket:', err);
      this.scheduleReconnect();
      return;
    }

    this.ws.on('open', () => {
      log.info('[WS] Connected');
      this.setState('connected');
      this.reconnectDelay = INITIAL_RECONNECT_DELAY;
      this.startHeartbeat();
      this.send({ type: 'status', status: 'ONLINE' });
    });

    this.ws.on('message', (raw: WebSocket.Data) => {
      try {
        const text = typeof raw === 'string' ? raw : raw.toString('utf-8');
        const message = JSON.parse(text) as IncomingMessage;

        if (message.type === 'print' || message.type === 'request-printers') {
          log.info(`[WS] Received: ${message.type}${message.type === 'print' ? ` (job ${message.jobId})` : ''}`);
          this.messageHandler?.(message);
        } else {
          log.debug(`[WS] Received unknown message type: ${(message as { type: string }).type}`);
        }
      } catch (err) {
        log.error('[WS] Failed to parse message:', err);
      }
    });

    this.ws.on('close', (code: number, reason: Buffer) => {
      log.info(`[WS] Closed — code=${code} reason=${reason.toString()}`);
      this.stopHeartbeat();
      this.ws = null;

      if (!this.intentionalDisconnect) {
        this.setState('disconnected');
        this.scheduleReconnect();
      }
    });

    this.ws.on('error', (err: Error) => {
      log.error('[WS] Error:', err.message);
      // The 'close' event will fire after this, triggering reconnect
    });
  }

  private startHeartbeat(): void {
    this.stopHeartbeat();
    this.heartbeatTimer = setInterval(() => {
      this.send({ type: 'heartbeat' });
    }, HEARTBEAT_INTERVAL);
  }

  private stopHeartbeat(): void {
    if (this.heartbeatTimer) {
      clearInterval(this.heartbeatTimer);
      this.heartbeatTimer = null;
    }
  }

  private scheduleReconnect(): void {
    if (this.intentionalDisconnect) return;

    log.info(`[WS] Reconnecting in ${this.reconnectDelay / 1000}s...`);

    this.reconnectTimer = setTimeout(() => {
      this.reconnectTimer = null;
      this.doConnect();
    }, this.reconnectDelay);

    // Exponential backoff: 1s → 2s → 4s → 8s → 16s → 30s (capped)
    this.reconnectDelay = Math.min(this.reconnectDelay * 2, MAX_RECONNECT_DELAY);
  }

  private clearTimers(): void {
    this.stopHeartbeat();
    if (this.reconnectTimer) {
      clearTimeout(this.reconnectTimer);
      this.reconnectTimer = null;
    }
  }
}
