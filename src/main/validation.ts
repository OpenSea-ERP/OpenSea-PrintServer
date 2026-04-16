/**
 * Funções de validação e parsing puras — sem dependências de Electron/Node I/O.
 * Extraídas para facilitar testes unitários.
 */

// ── WebSocket message validation ──────────────────────────────────────────

const MAX_PAYLOAD = 10 * 1024 * 1024;

export function isValidIncomingMessage(raw: unknown): boolean {
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

// ── API URL validation ────────────────────────────────────────────────────

export function isValidApiUrl(url: string, isPackaged = false): boolean {
  try {
    const parsed = new URL(url);
    if (!['http:', 'https:'].includes(parsed.protocol)) return false;
    if (isPackaged && parsed.protocol !== 'https:') return false;
    return true;
  } catch {
    return false;
  }
}

// ── Log sanitization ─────────────────────────────────────────────────────

export function safeLog(value: string | null | undefined, maxLen = 64): string {
  if (!value) return '(vazio)';
  return value.replace(/[\r\n\t\x00-\x1f]/g, '_').slice(0, maxLen);
}

// ── Rate limiter ─────────────────────────────────────────────────────────

export function createRateLimiter() {
  const lastCalled = new Map<string, number>();

  return function rateLimit(channel: string, minIntervalMs: number): boolean {
    const now = Date.now();
    const last = lastCalled.get(channel) ?? 0;
    if (now - last < minIntervalMs) return false;
    lastCalled.set(channel, now);
    return true;
  };
}

// ── Print format detection ───────────────────────────────────────────────

export type PrintFormat = 'pdf' | 'postscript' | 'raw';

export function detectFormat(data: Buffer): PrintFormat {
  if (data.length >= 4 && data[0] === 0x25 && data[1] === 0x50 && data[2] === 0x44 && data[3] === 0x46) {
    return 'pdf'; // %PDF
  }
  if (data.length >= 2 && data[0] === 0x25 && data[1] === 0x21) {
    return 'postscript'; // %!
  }
  return 'raw';
}

// ── Network printer IP extraction ────────────────────────────────────────

export function extractIpFromPort(portName: string): string | null {
  if (!portName) return null;
  const cleaned = portName
    .replace(/^(IP_|TCP_|TCPMON:|WSD-)/i, '')
    .split('_')[0]
    .trim();

  const match = cleaned.match(/^(\d{1,3}\.\d{1,3}\.\d{1,3}\.\d{1,3})/);
  return match ? match[1] : null;
}

// ── Printer status mapping ───────────────────────────────────────────────

export type DetectorStatus = 'ready' | 'offline' | 'error' | 'unknown';
export type BackendStatus = 'ONLINE' | 'OFFLINE' | 'ERROR' | 'UNKNOWN';

export enum PrinterStatusCode {
  ONLINE = 0,
  OFFLINE = 1,
  ERROR = 2,
  UNKNOWN = 3,
}

export function detectorToCode(status: DetectorStatus): PrinterStatusCode {
  switch (status) {
    case 'ready': return PrinterStatusCode.ONLINE;
    case 'offline': return PrinterStatusCode.OFFLINE;
    case 'error': return PrinterStatusCode.ERROR;
    default: return PrinterStatusCode.UNKNOWN;
  }
}

export function detectorToBackend(status: DetectorStatus): BackendStatus {
  switch (status) {
    case 'ready': return 'ONLINE';
    case 'offline': return 'OFFLINE';
    case 'error': return 'ERROR';
    default: return 'UNKNOWN';
  }
}

// ── Windows printer status mapping ───────────────────────────────────────

export interface Win32PrinterFields {
  PrinterStatus: number;
  WorkOffline: boolean;
  PortName: string;
  PnpStatus?: string;
}

export function mapWindowsStatusWithPnp(printer: Win32PrinterFields): DetectorStatus {
  const isUsb = (printer.PortName ?? '').toUpperCase().startsWith('USB');

  if (isUsb && printer.PnpStatus) {
    if (printer.PnpStatus !== 'OK') return 'offline';
  }

  if (printer.WorkOffline) return 'offline';

  switch (printer.PrinterStatus) {
    case 3: // Idle
    case 4: // Printing
    case 5: // Warmup
      return 'ready';
    case 7: // Offline
      return 'offline';
    case 6: // Stopped/Error
      return 'error';
    default:
      return 'unknown';
  }
}

// ── Windows printer type classification ──────────────────────────────────

export type PrinterType = 'local' | 'network' | 'virtual';

export function classifyWindowsPrinterType(name: string, portName: string): PrinterType {
  const lowerName = name.toLowerCase();
  const lowerPort = portName.toLowerCase();

  if (
    lowerName.includes('pdf') ||
    lowerName.includes('xps') ||
    lowerName.includes('onenote') ||
    lowerName.includes('fax') ||
    lowerName.includes('print to')
  ) {
    return 'virtual';
  }

  if (lowerPort.startsWith('\\\\') || lowerPort.includes('ip_') || lowerPort.startsWith('tcp')) {
    return 'network';
  }

  return 'local';
}

// ── Job queue parsing ────────────────────────────────────────────────────

export type JobStatus = 'printing' | 'queued' | 'paused' | 'error' | 'deleting';

export function mapWindowsJobStatus(status: string): JobStatus {
  const lower = status.toLowerCase();
  if (lower.includes('print') || lower.includes('spool')) return 'printing';
  if (lower.includes('paus')) return 'paused';
  if (lower.includes('error') || lower.includes('fail') || lower.includes('blocked')) return 'error';
  if (lower.includes('delet')) return 'deleting';
  return 'queued';
}

export function parseWindowsDate(raw: unknown): string {
  if (!raw) return new Date().toISOString();
  const str = String(raw);
  const match = str.match(/\/Date\((\d+)\)\//);
  if (match) {
    return new Date(Number(match[1])).toISOString();
  }
  try {
    const d = new Date(str);
    if (isNaN(d.getTime())) return new Date().toISOString();
    return d.toISOString();
  } catch {
    return new Date().toISOString();
  }
}
