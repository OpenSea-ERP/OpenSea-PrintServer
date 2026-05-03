/**
 * Thin wrapper over `@opensea/satellite-runtime/ws-client@v0.4.0`.
 *
 * Preserves the public API used by main.ts and ipc-handlers.ts:
 *   - `PrintServerWSClient` class with `connect(apiUrl, agentToken)`,
 *     `disconnect()`, `send(message)`, `onMessage(handler)`, `state` getter,
 *     and EventEmitter events `'state'`, `'release'`, `'revoked'`, `'message'`.
 *   - `isValidIncomingMessage(raw)` for unit tests + main.ts message dispatch.
 *
 * Internally delegates transport lifecycle to `SatelliteWSClient` and
 * keeps PrintServer-specific concerns local: the print-message validator
 * (with `printerName ?? printerId` legacy compatibility) and the
 * `state: 'disconnected'|'connecting'|'connected'` mapping the renderer
 * already understands.
 */
import { EventEmitter } from "events";
import {
  SatelliteWSClient,
  type ReleaseEventPayload,
  type RevokedEventPayload,
} from "@opensea/satellite-runtime/ws-client";
import type {
  WsAppReleasePublishedMessage,
  WsDeviceRevokedMessage,
  WsWelcomeMessage,
} from "@opensea/satellite-contract";

// ── Types (preserved for consumers) ──────────────────────────────────────

export type ConnectionState = "disconnected" | "connecting" | "connected";

export interface PrintCommand {
  type: "print";
  jobId: string;
  printerName?: string;
  printerId: string;
  data: string;
  copies: number;
}

export interface RequestPrintersCommand {
  type: "request-printers";
}

export type PrintIncomingMessage = PrintCommand | RequestPrintersCommand;

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
  durationMs?: number;
}

export interface PrintersListMessage {
  type: "printers";
  printers: PrinterInfo[];
}

export interface StatusMessage {
  type: "status";
  status: "ONLINE" | "OFFLINE";
}

export interface HeartbeatOutgoingMessage {
  type: "heartbeat";
}

export type OutgoingMessage =
  | PrintResultMessage
  | PrintersListMessage
  | StatusMessage
  | HeartbeatOutgoingMessage;

type MessageHandler = (msg: IncomingMessage) => void;

// ── Validators ───────────────────────────────────────────────────────────

const MAX_PAYLOAD = 10 * 1024 * 1024;

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

/**
 * Public validator preserved for `ws-client.spec.ts` and any caller that
 * wants to validate a raw payload OUT of the live socket pipeline.
 *
 * In the live pipeline, the runtime client owns shared-message validation
 * + routing, so this function effectively gates only the print-specific
 * messages that reach `onDomainMessage` in the wrapper below.
 */
export function isValidIncomingMessage(raw: unknown): raw is IncomingMessage {
  return isValidPrintMessage(raw) || isValidSharedMessage(raw);
}

// ── Wrapper class ────────────────────────────────────────────────────────

export class PrintServerWSClient extends EventEmitter {
  private inner: SatelliteWSClient<
    PrintIncomingMessage,
    OutgoingMessage
  > | null = null;
  private apiUrl: string = "";
  private agentToken: string = "";
  private messageHandler: MessageHandler | null = null;
  private _state: ConnectionState = "disconnected";

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
    if (this.inner) {
      this.inner.destroy();
      this.inner = null;
    }

    this.inner = new SatelliteWSClient<PrintIncomingMessage, OutgoingMessage>({
      buildUrl: () => this.apiUrl,
      auth: { kind: "bearer-header", token: () => this.agentToken },
      heartbeat: {
        intervalMs: 20000,
        pongTimeoutMs: 10000,
        appHeartbeat: () => ({ type: "heartbeat" }),
      },
      validateIncoming: (raw) =>
        isValidPrintMessage(raw) ? (raw as PrintIncomingMessage) : null,
      onDomainMessage: (msg) => {
        // Forward to legacy onMessage callback so main.ts dispatches stay unchanged.
        this.messageHandler?.(msg as IncomingMessage);
        this.emit("message", msg);
      },
      routeShared: true,
      satelliteKind: "PRINT_SERVER",
      logScope: "print-server/ws",
    });

    this.inner.on("state", (state) => this.setState(this.mapState(state)));
    this.inner.on("release", (release: ReleaseEventPayload) => {
      this.emit("release", release);
    });
    this.inner.on("revoked", (revoked: RevokedEventPayload) => {
      this.emit("revoked", revoked);
    });
    this.inner.on("error", (err) => this.emit("error", err));

    this.inner.connect();
  }

  disconnect(): void {
    if (!this.inner) return;
    this.inner.destroy();
    this.inner = null;
    this.setState("disconnected");
  }

  send(message: OutgoingMessage): boolean {
    if (!this.inner) return false;
    return this.inner.send(message);
  }

  private setState(state: ConnectionState): void {
    if (this._state === state) return;
    this._state = state;
    this.emit("state", state);
  }

  private mapState(
    runtimeState:
      | "idle"
      | "waiting-auth"
      | "connecting"
      | "connected"
      | "reconnecting"
      | "error"
      | "closed",
  ): ConnectionState {
    if (runtimeState === "connected") return "connected";
    if (runtimeState === "connecting" || runtimeState === "reconnecting") {
      return "connecting";
    }
    return "disconnected";
  }
}
