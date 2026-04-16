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
  status: 'ONLINE' | 'OFFLINE' | 'ERROR' | 'UNKNOWN';
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

export interface HelloMessage {
  type: 'hello';
  protocolVersion: string;
  clientVersion: string;
}

export interface StatusMessage {
  type: 'status';
  status: 'ONLINE' | 'OFFLINE';
}

export type OutgoingMessage =
  | HeartbeatMessage
  | HelloMessage
  | PrintersMessage
  | PrintResultMessage
  | StatusMessage;

type MessageHandler = (message: IncomingMessage) => void;

// ── Constants ────────────────────────────────────────────────────────────────

const INITIAL_RECONNECT_DELAY = 1000;
const MAX_RECONNECT_DELAY = 30000;
const HEARTBEAT_INTERVAL = 25000;
const PONG_TIMEOUT = 10000;
const MAX_PAYLOAD = 10 * 1024 * 1024; // 10MB
const PROTOCOL_VERSION = '1.0';
// Evitar require do package.json via ts; versão do cliente é informacional
const CLIENT_VERSION = process.env.npm_package_version ?? 'unknown';

// ── Validation ───────────────────────────────────────────────────────────────

function isValidIncomingMessage(raw: unknown): raw is IncomingMessage {
  if (!raw || typeof raw !== 'object') return false;
  const msg = raw as { type?: unknown };

  if (msg.type === 'request-printers') return true;

  if (msg.type === 'print') {
    const m = raw as Record<string, unknown>;
    return (
      typeof m.jobId === 'string' &&
      m.jobId.length > 0 &&
      m.jobId.length <= 128 &&
      typeof m.printerId === 'string' &&
      m.printerId.length > 0 &&
      m.printerId.length <= 256 &&
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

// ── WebSocket Client ─────────────────────────────────────────────────────────

export class PrintServerWSClient extends EventEmitter {
  private ws: WebSocket | null = null;
  private apiUrl: string = '';
  private agentToken: string = '';
  private reconnectDelay: number = INITIAL_RECONNECT_DELAY;
  private reconnectTimer: ReturnType<typeof setTimeout> | null = null;
  private heartbeatTimer: ReturnType<typeof setInterval> | null = null;
  private pongTimer: ReturnType<typeof setTimeout> | null = null;
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

  onMessage(handler: MessageHandler): void {
    this.messageHandler = handler;
  }

  connect(apiUrl: string, agentToken: string): void {
    this.apiUrl = apiUrl;
    this.agentToken = agentToken;
    this.intentionalDisconnect = false;
    this.reconnectDelay = INITIAL_RECONNECT_DELAY;

    this.doConnect();
  }

  disconnect(): void {
    this.intentionalDisconnect = true;
    this.clearTimers();
    this.teardownSocket();
    this.setState('disconnected');
  }

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

  private teardownSocket(): void {
    if (!this.ws) return;
    try {
      this.ws.removeAllListeners();
      this.ws.close(1000, 'Client teardown');
    } catch {
      // Já fechado
    }
    this.ws = null;
  }

  private doConnect(): void {
    this.clearTimers();
    this.teardownSocket();

    const wsProtocol = this.apiUrl.startsWith('https') ? 'wss' : 'ws';
    const baseUrl = this.apiUrl.replace(/^https?/, wsProtocol).replace(/\/+$/, '');
    // Token agora viaja no header Authorization — nunca em query string.
    const url = `${baseUrl}/v1/ws/print-agent`;

    this.setState('connecting');
    log.info(`[WS] Connecting to ${url}`);

    try {
      this.ws = new WebSocket(url, {
        headers: {
          Authorization: `Bearer ${this.agentToken}`,
        },
        maxPayload: MAX_PAYLOAD,
        handshakeTimeout: 15000,
      });
    } catch (err) {
      log.error('[WS] Failed to create WebSocket:', err);
      this.scheduleReconnect();
      return;
    }

    this.ws.on('open', () => {
      log.info('[WS] Connected');
      this.setState('connected');
      this.reconnectDelay = INITIAL_RECONNECT_DELAY;
      this.send({ type: 'hello', protocolVersion: PROTOCOL_VERSION, clientVersion: CLIENT_VERSION });
      this.send({ type: 'status', status: 'ONLINE' });
      this.startHeartbeat();
    });

    this.ws.on('message', (raw: WebSocket.Data, isBinary: boolean) => {
      if (isBinary) {
        log.warn('[WS] Mensagem binária recebida ignorada');
        return;
      }

      let text: string;
      try {
        text = raw.toString('utf-8');
      } catch {
        log.warn('[WS] Falha ao converter mensagem para UTF-8');
        return;
      }

      if (text.length > MAX_PAYLOAD) {
        log.warn(`[WS] Payload excede ${MAX_PAYLOAD} bytes — descartado`);
        return;
      }

      let parsed: unknown;
      try {
        parsed = JSON.parse(text);
      } catch (err) {
        log.error('[WS] JSON inválido:', err);
        return;
      }

      if (!isValidIncomingMessage(parsed)) {
        log.warn('[WS] Mensagem com schema inválido descartada:', (parsed as { type?: unknown })?.type);
        return;
      }

      log.info(
        `[WS] Received: ${parsed.type}${parsed.type === 'print' ? ` (job ${parsed.jobId})` : ''}`,
      );
      this.messageHandler?.(parsed);
    });

    this.ws.on('pong', () => {
      if (this.pongTimer) {
        clearTimeout(this.pongTimer);
        this.pongTimer = null;
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
    });
  }

  private startHeartbeat(): void {
    this.stopHeartbeat();
    this.heartbeatTimer = setInterval(() => {
      if (!this.ws || this.ws.readyState !== WebSocket.OPEN) return;

      try {
        this.ws.ping();
      } catch (err) {
        log.error('[WS] Falha ao enviar ping:', err);
        return;
      }

      // Se não receber pong dentro de PONG_TIMEOUT, força reconexão
      if (this.pongTimer) clearTimeout(this.pongTimer);
      this.pongTimer = setTimeout(() => {
        log.warn(`[WS] Sem resposta de pong em ${PONG_TIMEOUT}ms — forçando reconexão`);
        this.forceReconnect();
      }, PONG_TIMEOUT);
    }, HEARTBEAT_INTERVAL);
  }

  private stopHeartbeat(): void {
    if (this.heartbeatTimer) {
      clearInterval(this.heartbeatTimer);
      this.heartbeatTimer = null;
    }
    if (this.pongTimer) {
      clearTimeout(this.pongTimer);
      this.pongTimer = null;
    }
  }

  private forceReconnect(): void {
    if (this.intentionalDisconnect) return;
    this.teardownSocket();
    this.setState('disconnected');
    this.scheduleReconnect();
  }

  private scheduleReconnect(): void {
    if (this.intentionalDisconnect) return;
    if (this.reconnectTimer) return; // Já agendado

    log.info(`[WS] Reconnecting in ${this.reconnectDelay / 1000}s...`);

    this.reconnectTimer = setTimeout(() => {
      this.reconnectTimer = null;
      this.doConnect();
    }, this.reconnectDelay);

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
