import { exec } from 'child_process';
import { promisify } from 'util';
import log from 'electron-log';

const execAsync = promisify(exec);

// ── Types ────────────────────────────────────────────────────────────────────

export interface DetectedPrinter {
  name: string;
  type: 'local' | 'network' | 'virtual';
  isDefault: boolean;
  status: 'ready' | 'offline' | 'error' | 'unknown';
}

// ── Cache ────────────────────────────────────────────────────────────────────

const CACHE_TTL = 10_000; // 10 seconds

let cachedPrinters: DetectedPrinter[] | null = null;
let cacheTimestamp: number = 0;

// ── Public API ───────────────────────────────────────────────────────────────

/**
 * Detect printers installed on the operating system.
 * Results are cached for 10 seconds to avoid excessive re-scanning.
 */
export async function detectPrinters(): Promise<DetectedPrinter[]> {
  const now = Date.now();

  if (cachedPrinters && now - cacheTimestamp < CACHE_TTL) {
    return cachedPrinters;
  }

  try {
    let printers: DetectedPrinter[];

    switch (process.platform) {
      case 'win32':
        printers = await detectWindowsPrinters();
        break;
      case 'darwin':
        printers = await detectUnixPrinters();
        break;
      case 'linux':
        printers = await detectUnixPrinters();
        break;
      default:
        log.warn(`[Printer] Unsupported platform: ${process.platform}`);
        printers = [];
    }

    cachedPrinters = printers;
    cacheTimestamp = now;
    log.info(`[Printer] Detected ${printers.length} printer(s)`);
    return printers;
  } catch (err) {
    log.error('[Printer] Detection failed:', err);
    return [];
  }
}

/**
 * Force-clear the printer cache so the next call re-scans.
 */
export function clearPrinterCache(): void {
  cachedPrinters = null;
  cacheTimestamp = 0;
}

// ── Windows ──────────────────────────────────────────────────────────────────

interface Win32PrinterRaw {
  Name: string;
  PrinterStatus: number;
  WorkOffline: boolean;
  Default: boolean;
  PortName: string;
}

function classifyWindowsPrinterType(name: string, portName: string): DetectedPrinter['type'] {
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

async function detectWindowsPrinters(): Promise<DetectedPrinter[]> {
  // Two-step detection like OpenSea-Agent:
  // 1. Get-CimInstance Win32_Printer for printer list + basic status
  // 2. Get-PnpDevice -Class Printer for USB connectivity check
  const psCommand = [
    '$printers = Get-CimInstance Win32_Printer | Select-Object Name, PrinterStatus, WorkOffline, Default, PortName;',
    '$pnp = @{};',
    'try { Get-PnpDevice -Class Printer -ErrorAction SilentlyContinue | ForEach-Object { $pnp[$_.FriendlyName] = $_.Status } } catch {};',
    '$printers | ForEach-Object { $_ | Add-Member -NotePropertyName PnpStatus -NotePropertyValue ($pnp[$_.Name]) -Force };',
    '$printers | ConvertTo-Json -Compress',
  ].join(' ');

  try {
    const { stdout } = await execAsync(`powershell -NoProfile -Command "${psCommand}"`, {
      timeout: 15_000,
    });

    if (!stdout.trim()) return [];

    let raw: unknown;
    try {
      raw = JSON.parse(stdout.trim());
    } catch (parseErr) {
      log.warn('[Printer] PowerShell JSON inválido, usando wmic:', parseErr);
      return detectWindowsPrintersWmic();
    }

    const items = Array.isArray(raw) ? raw : [raw];
    const valid = items.filter((item): item is Win32PrinterRaw & { PnpStatus?: string } => {
      return (
        !!item &&
        typeof item === 'object' &&
        typeof (item as { Name?: unknown }).Name === 'string' &&
        (item as { Name: string }).Name.length > 0
      );
    });

    if (valid.length !== items.length) {
      log.warn(`[Printer] ${items.length - valid.length} itens com schema inválido descartados`);
    }

    if (valid.length === 0) {
      log.warn('[Printer] Nenhum item válido no JSON do PowerShell, usando wmic');
      return detectWindowsPrintersWmic();
    }

    return valid.map((p) => ({
      name: p.Name,
      type: classifyWindowsPrinterType(p.Name, p.PortName ?? ''),
      isDefault: !!p.Default,
      status: mapWindowsStatusWithPnp(p),
    }));
  } catch (err) {
    log.warn('[Printer] PowerShell detection failed, trying wmic fallback:', err);
    return detectWindowsPrintersWmic();
  }
}

function mapWindowsStatusWithPnp(printer: Win32PrinterRaw & { PnpStatus?: string }): DetectedPrinter['status'] {
  const isUsb = (printer.PortName ?? '').toUpperCase().startsWith('USB');

  // For USB printers: check PnP device status (most reliable)
  if (isUsb && printer.PnpStatus) {
    if (printer.PnpStatus !== 'OK') return 'offline';
  }

  // WorkOffline flag
  if (printer.WorkOffline) return 'offline';

  // PrinterStatus from Win32_Printer
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

async function detectWindowsPrintersWmic(): Promise<DetectedPrinter[]> {
  try {
    const { stdout } = await execAsync(
      'wmic printer get name,default,status,portname /format:csv',
      { timeout: 10_000 },
    );

    const lines = stdout
      .trim()
      .split('\n')
      .map((l) => l.trim())
      .filter((l) => l.length > 0);

    if (lines.length < 2) return [];

    // CSV header: Node,Default,Name,PortName,Status
    const header = lines[0].toLowerCase().split(',');
    const nameIdx = header.indexOf('name');
    const defaultIdx = header.indexOf('default');
    const statusIdx = header.indexOf('status');
    const portIdx = header.indexOf('portname');

    if (nameIdx === -1) return [];

    const printers: DetectedPrinter[] = [];

    for (let i = 1; i < lines.length; i++) {
      const cols = lines[i].split(',');
      if (!cols[nameIdx]) continue;

      const name = cols[nameIdx].trim();
      const isDefault = cols[defaultIdx]?.trim().toUpperCase() === 'TRUE';
      const statusStr = cols[statusIdx]?.trim().toLowerCase() ?? '';
      const portName = cols[portIdx]?.trim().toLowerCase() ?? '';

      let type: DetectedPrinter['type'] = 'local';
      const lowerName = name.toLowerCase();
      if (
        lowerName.includes('pdf') ||
        lowerName.includes('xps') ||
        lowerName.includes('onenote') ||
        lowerName.includes('fax')
      ) {
        type = 'virtual';
      } else if (portName.startsWith('\\\\') || portName.includes('ip_')) {
        type = 'network';
      }

      let status: DetectedPrinter['status'] = 'unknown';
      if (statusStr === 'ok' || statusStr === 'idle' || statusStr === 'ready') {
        status = 'ready';
      } else if (statusStr === 'offline') {
        status = 'offline';
      } else if (statusStr === 'error') {
        status = 'error';
      }

      printers.push({ name, type, isDefault, status });
    }

    return printers;
  } catch (err) {
    log.error('[Printer] wmic fallback also failed:', err);
    return [];
  }
}

// ── macOS / Linux (CUPS) ─────────────────────────────────────────────────────

async function detectUnixPrinters(): Promise<DetectedPrinter[]> {
  try {
    const { stdout } = await execAsync('lpstat -p -d 2>/dev/null', {
      timeout: 10_000,
    });

    const lines = stdout.trim().split('\n').filter((l) => l.length > 0);
    const printers: DetectedPrinter[] = [];
    let defaultPrinter: string | null = null;

    // Parse default printer line: "system default destination: PrinterName"
    for (const line of lines) {
      const defaultMatch = line.match(/system default destination:\s*(.+)/i);
      if (defaultMatch) {
        defaultPrinter = defaultMatch[1].trim();
      }
    }

    // Parse printer lines: "printer PrinterName is idle. enabled since ..."
    // or: "printer PrinterName disabled since ..."
    for (const line of lines) {
      const printerMatch = line.match(/^printer\s+(\S+)\s+(is\s+)?(.+)/i);
      if (!printerMatch) continue;

      const name = printerMatch[1];
      const rest = printerMatch[3].toLowerCase();

      let status: DetectedPrinter['status'] = 'unknown';
      if (rest.includes('idle') || rest.includes('enabled')) {
        status = 'ready';
      } else if (rest.includes('disabled') || rest.includes('offline')) {
        status = 'offline';
      } else if (rest.includes('error') || rest.includes('fault')) {
        status = 'error';
      }

      const lowerName = name.toLowerCase();
      let type: DetectedPrinter['type'] = 'local';
      if (
        lowerName.includes('pdf') ||
        lowerName.includes('cups-pdf') ||
        lowerName.includes('virtual')
      ) {
        type = 'virtual';
      }

      printers.push({
        name,
        type,
        isDefault: name === defaultPrinter,
        status,
      });
    }

    // Try to get more type info from lpstat -v (connection URIs)
    try {
      const { stdout: vOut } = await execAsync('lpstat -v 2>/dev/null', {
        timeout: 5_000,
      });

      for (const line of vOut.trim().split('\n')) {
        // "device for PrinterName: ipp://..."
        const match = line.match(/^device for\s+(\S+?):\s*(.+)/i);
        if (!match) continue;

        const pName = match[1];
        const uri = match[2].trim().toLowerCase();
        const printer = printers.find((p) => p.name === pName);
        if (!printer) continue;

        if (
          uri.startsWith('ipp://') ||
          uri.startsWith('ipps://') ||
          uri.startsWith('socket://') ||
          uri.startsWith('smb://') ||
          uri.startsWith('lpd://')
        ) {
          printer.type = 'network';
        } else if (uri.includes('cups-pdf') || uri.includes('/dev/null')) {
          printer.type = 'virtual';
        }
      }
    } catch {
      // lpstat -v not critical
    }

    return printers;
  } catch (err) {
    log.error('[Printer] lpstat failed:', err);
    return [];
  }
}
