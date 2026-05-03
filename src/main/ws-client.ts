import WebSocket from "ws";
import { EventEmitter } from "events";
import log from "electron-log";
import type {
  WsAppReleasePublishedMessage,
  WsDeviceRevokedMessage,
  WsWelcomeMessage,
} from "@opensea/satellite-contract";

// ── Types ────────────────────────────────────────────────────────────────────

export type ConnectionState = "disconnected" | "connecting" | "connected";

export interface PrintCommand {
  type: "print";
  jobId: string;
  /**
   * OS-level printer name as reported during pairing (Win32_Printer.Name
   * on Windows, CUPS queue name on Unix). Preferred field — added in
   * PrintServer v1.7 + API contract revision 2026-05-02. Older API
   * builds still send `printerId` carrying the OS name as a transitional
   * alias; the consumer reads `printerName ?? printerId`.
   */
  printerName?: string;
  /**
   * Legacy alias kept for back-compat with API builds that have not yet
   * been redeployed with the contract rename. Will be removed once the
   * PrintServer fleet is fully on the new contract AND the API only
   * emits `printerName`.
   */
  printerId: string;
  data: string; // base64-encoded
  copies: number;
}

export interface RequestPrintersCommand {
  type: "request-printers";
}

/**
 * Print-specific command set (server → client). Stays local because the
 * shared `@opensea/satellite-contract` package only covers cross-satellite
 * concerns (lifecycle: hello/welcome, releases, revocation, heartbeat).
 */
export type PrintIncomingMessage = PrintCommand | RequestPrintersCommand;

/**
 * Shared satellite messages (server → client). Adopted from
 * `@opensea/satellite-contract@^0.1.0`. Currently the API does not push
 * these to print-agent connections — that wiring lands in Phase 14
 * (SAT-OBSERVABILITY-01). The PrintServer recognises and dispatches them
 * already so it is forward-compatible the moment the broadcast wiring
 * goes live, and so a new build does not need to re-cut just to receive
 * release notifications.
 */
export type SharedIncomingMessage =
  | WsWelcomeMessage
  | WsAppReleasePublishedMessage
  | WsDeviceRevokedMessage;

export type IncomingMessage = PrintIncomingMessage | SharedIncomingMessage;

export interface PrinterInfo {
  name: string;
  type: "local" | "network" | "virtual";
  isDefault: boolean;
  status: "ONLINE" | "OFFLINE" | "ERROR" | "UNKNOWN";
}

export interface PrintResultMessage {
  type: "print-result";
  jobId: string;
  success: boolean;
  error?: string;
  /**
   * Telemetry — milliseconds the local print pipeline took (received →
   * print-result emitted). The backend persists it on `print_jobs` so
   * operators can graph slow devices without scraping logs.
   */
  durationMs?: number;
}

export interface PrintersMessage {
  type: "printers";
  printers: PrinterInfo[];
}

export interface HeartbeatMessage {
  type: "heartbeat";
}

export interface HelloMessage {
  type: "hello";
  protocolVersion: string;
  clientVersion: string;
}

export interface StatusMessage {
  type: "status";
  status: "ONLINE" | "OFFLINE";
}

export type OutgoingMessage =
  | HeartbeatMessage
  | HelloMessage
  | PrintersMessage
  | PrintResultMessage
  | StatusMessage;

type MessageHandler = (message: PrintIncomingMessage) => void;

// ── Constants ────────────────────────────────────────────────────────────────

const INITIAL_RECONNECT_DELAY = 1000;
const MAX_RECONNECT_DELAY = 30000;
const HEARTBEAT_INTERVAL = 25000;
const PONG_TIMEOUT = 10000;
const MAX_PAYLOAD = 10 * 1024 * 1024; // 10MB
const PROTOCOL_VERSION = "1.0";
// Evitar require do package.json via ts; versão do cliente é informacional
const CLIENT_VERSION = process.env.npm_package_version ?? "unknown";

// ── Validation ───────────────────────────────────────────────────────────────

const VALID_DEVICE_REVOKED_REASONS = new Set([
  "unpaired_by_user",
  "unpaired_by_admin",
  "force_revoked_by_admin",
]);

const VALID_RELEASE_KINDS = new Set(["EMPORION", "PRINT_SERVER", "HORUS"]);

function isValidPrintMessage(raw: unknown): raw is PrintIncomingMessage {
  if (!raw || typeof raw !== "object") return false;
  const msg = raw as { type?: unknown };

  if (msg.type === "request-printers") return true;

  if (msg.type === "print") {
    const m = raw as Record<string, unknown>;
    // Accept either `printerName` (preferred, contract revision
    // 2026-05-02) or the legacy `printerId` field whose value is also an
    // OS device name. At least one must be a non-empty string.
    const hasPrinterName =
      typeof m.printerName === "string" &&
      m.printerName.length > 0 &&
      m.printerName.length <= 256;
    const hasPrinterId =
      typeof m.printerId === "string" &&
      m.printerId.length > 0 &&
      m.printerId.length <= 256;
    return (
      typeof m.jobId === "string" &&
      m.jobId.length > 0 &&
      m.jobId.length <= 128 &&
      (hasPrinterName || hasPrinterId) &&
      typeof m.data === "string" &&
      m.data.length > 0 &&
      m.data.length <= MAX_PAYLOAD &&
      typeof m.copies === "number" &&
      Number.isInteger(m.copies) &&
      m.copies >= 1 &&
      m.copies <= 999
    );
  }

  return false;
}

function isValidSharedMessage(raw: unknown): raw is SharedIncomingMessage {
  if (!raw || typeof raw !== "object") return false;
  const msg = raw as Record<string, unknown>;

  if (msg.type === "welcome") {
    return (
      typeof msg.terminalId === "string" &&
      typeof msg.protocolVersion === "string"
    );
  }

  if (msg.type === "app.release.published") {
    return (
      typeof msg.kind === "string" &&
      VALID_RELEASE_KINDS.has(msg.kind) &&
      typeof msg.version === "string" &&
      typeof msg.downloadUrl === "string" &&
      typeof msg.sha256 === "string" &&
      msg.sha256.length === 64 &&
      typeof msg.releasedAt === "string"
    );
  }

  if (msg.type === "device.revoked") {
    return (
      typeof msg.reason === "string" &&
      VALID_DEVICE_REVOKED_REASONS.has(msg.reason) &&
      typeof msg.revokedAt === "string" &&
      typeof msg.revokedBy === "object" &&
      msg.revokedBy !== null
    );
  }

  return false;
}

export function isValidIncomingMessage(raw: unknown): raw is IncomingMessage {
  return isValidPrintMessage(raw) || isValidSharedMessage(raw);
}

// ── WebSocket Client ─────────────────────────────────────────────────────────

export class PrintServerWSClient extends EventEmitter {
  private ws: WebSocket | null = null;
  private apiUrl: string = "";
  private agentToken: string = "";
  private reconnectDelay: number = INITIAL_RECONNECT_DELAY;
  private reconnectTimer: ReturnType<typeof setTimeout> | null = null;
  private heartbeatTimer: ReturnType<typeof setInterval> | null = null;
  private pongTimer: ReturnType<typeof setTimeout> | null = null;
  private messageHandler: MessageHandler | null = null;
  private intentionalDisconnect: boolean = false;
  private _state: ConnectionState = "disconnected";

  get state(): ConnectionState {
    return this._state;
  }

  private setState(state: ConnectionState): void {
    if (this._state === state) return;
    this._state = state;
    this.emit("state", state);
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
    this.setState("disconnected");
  }

  send(message: OutgoingMessage): boolean {
    if (!this.ws || this.ws.readyState !== WebSocket.OPEN) {
      log.warn("[WS] Cannot send message — not connected");
      return false;
    }

    try {
      this.ws.send(JSON.stringify(message));
      return true;
    } catch (err) {
      log.error("[WS] Failed to send message:", err);
      return false;
    }
  }

  // ── Private ──────────────────────────────────────────────────────────────

  private teardownSocket(): void {
    if (!this.ws) return;
    try {
      this.ws.removeAllListeners();
      this.ws.close(1000, "Client teardown");
    } catch {
      // Já fechado
    }
    this.ws = null;
  }

  private doConnect(): void {
    this.clearTimers();
    this.teardownSocket();

    const wsProtocol = this.apiUrl.startsWith("https") ? "wss" : "ws";
    const baseUrl = this.apiUrl
      .replace(/^https?/, wsProtocol)
      .replace(/\/+$/, "");
    // Token agora viaja no header Authorization — nunca em query string.
    const url = `${baseUrl}/v1/ws/print-agent`;

    this.setState("connecting");
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
      log.error("[WS] Failed to create WebSocket:", err);
      this.scheduleReconnect();
      return;
    }

    this.ws.on("open", () => {
      log.info("[WS] Connected");
      this.setState("connected");
      this.reconnectDelay = INITIAL_RECONNECT_DELAY;
      this.send({
        type: "hello",
        protocolVersion: PROTOCOL_VERSION,
        clientVersion: CLIENT_VERSION,
      });
      this.send({ type: "status", status: "ONLINE" });
      this.startHeartbeat();
    });

    this.ws.on("message", (raw: WebSocket.Data, isBinary: boolean) => {
      if (isBinary) {
        log.warn("[WS] Mensagem binária recebida ignorada");
        return;
      }

      let text: string;
      try {
        text = raw.toString("utf-8");
      } catch {
        log.warn("[WS] Falha ao converter mensagem para UTF-8");
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
        log.error("[WS] JSON inválido:", err);
        return;
      }

      if (!isValidIncomingMessage(parsed)) {
        log.warn(
          "[WS] Mensagem com schema inválido descartada:",
          (parsed as { type?: unknown })?.type,
        );
        return;
      }

      log.info(
        `[WS] Received: ${parsed.type}${parsed.type === "print" ? ` (job ${parsed.jobId})` : ""}`,
      );

      // Shared satellite messages route to typed events so callers can
      // subscribe by concern (`release`, `revoked`, `welcome`) without
      // every print-specific handler having to switch on `type` first.
      // Print-specific messages still flow through `messageHandler` for
      // back-compat with the existing main.ts dispatcher.
      switch (parsed.type) {
        case "welcome":
          this.emit("welcome", parsed);
          break;
        case "app.release.published":
          this.emit("release", parsed);
          break;
        case "device.revoked":
          this.emit("revoked", parsed);
          break;
        default:
          this.messageHandler?.(parsed);
      }
    });

    this.ws.on("pong", () => {
      if (this.pongTimer) {
        clearTimeout(this.pongTimer);
        this.pongTimer = null;
      }
    });

    this.ws.on("close", (code: number, reason: Buffer) => {
      log.info(`[WS] Closed — code=${code} reason=${reason.toString()}`);
      this.stopHeartbeat();
      this.ws = null;

      if (!this.intentionalDisconnect) {
        this.setState("disconnected");
        this.scheduleReconnect();
      }
    });

    this.ws.on("error", (err: Error) => {
      log.error("[WS] Error:", err.message);
    });
  }

  private startHeartbeat(): void {
    this.stopHeartbeat();
    this.heartbeatTimer = setInterval(() => {
      if (!this.ws || this.ws.readyState !== WebSocket.OPEN) return;

      // Application-level heartbeat: the API's `heartbeat-checker` only
      // refreshes `print_agents.lastSeenAt` when it sees the JSON
      // `{type:'heartbeat'}` (or a fresh `status` message). A bare WS
      // ping frame keeps the TCP socket alive but does NOT update the
      // DB column, so without this the agent gets marked OFFLINE after
      // 90s even though the connection is healthy.
      this.send({ type: "heartbeat" });

      try {
        this.ws.ping();
      } catch (err) {
        log.error("[WS] Falha ao enviar ping:", err);
        return;
      }

      // Se não receber pong dentro de PONG_TIMEOUT, força reconexão
      if (this.pongTimer) clearTimeout(this.pongTimer);
      this.pongTimer = setTimeout(() => {
        log.warn(
          `[WS] Sem resposta de pong em ${PONG_TIMEOUT}ms — forçando reconexão`,
        );
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
    this.setState("disconnected");
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

    this.reconnectDelay = Math.min(
      this.reconnectDelay * 2,
      MAX_RECONNECT_DELAY,
    );
  }

  private clearTimers(): void {
    this.stopHeartbeat();
    if (this.reconnectTimer) {
      clearTimeout(this.reconnectTimer);
      this.reconnectTimer = null;
    }
  }
}
