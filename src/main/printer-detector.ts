import { exec } from 'child_process';
import { promisify } from 'util';
import net from 'net';
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

export function clearPrinterCache(): void {
  cachedPrinters = null;
  cacheTimestamp = 0;
}

// ── TCP port probe ──────────────────────────────────────────────────────────

const PROBE_TIMEOUT_MS = 1500;
const RAW_PORT = 9100;  // Porta padrão de impressão raw (JetDirect)
const IPP_PORT = 631;   // IPP

/**
 * Tenta abrir uma conexão TCP ao IP da impressora.
 * Retorna true se conseguir conectar em até PROBE_TIMEOUT_MS.
 */
function probePort(host: string, port: number): Promise<boolean> {
  return new Promise((resolve) => {
    const socket = new net.Socket();
    let settled = false;

    const finish = (result: boolean) => {
      if (settled) return;
      settled = true;
      socket.destroy();
      resolve(result);
    };

    socket.setTimeout(PROBE_TIMEOUT_MS);
    socket.once('connect', () => finish(true));
    socket.once('timeout', () => finish(false));
    socket.once('error', () => finish(false));

    try {
      socket.connect(port, host);
    } catch {
      finish(false);
    }
  });
}

/**
 * Extrai IP de um PortName Windows. Suporta formatos comuns:
 * - "IP_192.168.1.100"
 * - "TCP_192.168.1.100"
 * - "192.168.1.100"
 * - "TCPMON:192.168.1.100"
 * - Portas com sufixo: "IP_192.168.1.100_1"
 */
function extractIpFromPort(portName: string): string | null {
  if (!portName) return null;
  // Remover prefixos comuns
  const cleaned = portName
    .replace(/^(IP_|TCP_|TCPMON:|WSD-)/i, '')
    .split('_')[0]  // pegar só o IP antes de sufixos como _1
    .trim();

  // IPv4 basic check
  const match = cleaned.match(/^(\d{1,3}\.\d{1,3}\.\d{1,3}\.\d{1,3})/);
  return match ? match[1] : null;
}

/**
 * Verifica conectividade real para impressoras de rede (TCP probe).
 * Para cada impressora com port TCP/IP, tenta conectar na porta 9100 (raw) ou 631 (IPP).
 * Se ambas falham → marca como offline.
 */
async function probeNetworkPrinters(
  printers: Array<{ printer: DetectedPrinter; portName: string }>,
): Promise<void> {
  const probePromises = printers.map(async ({ printer, portName }) => {
    const ip = extractIpFromPort(portName);
    if (!ip) return; // Sem IP extraível, mantém status do WMI

    // Testar porta raw (9100) primeiro, depois IPP (631)
    const rawOk = await probePort(ip, RAW_PORT);
    if (rawOk) return; // Online

    const ippOk = await probePort(ip, IPP_PORT);
    if (ippOk) return; // Online via IPP

    // Nenhuma porta respondeu — impressora offline
    log.debug(`[Printer] "${printer.name}" (${ip}) não respondeu TCP ${RAW_PORT}/${IPP_PORT} — marcando offline`);
    printer.status = 'offline';
  });

  await Promise.all(probePromises);
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

    // Fase 1: mapear status via WMI + PnP (USB)
    const results = valid.map((p) => ({
      printer: {
        name: p.Name,
        type: classifyWindowsPrinterType(p.Name, p.PortName ?? ''),
        isDefault: !!p.Default,
        status: mapWindowsStatusWithPnp(p),
      } as DetectedPrinter,
      portName: p.PortName ?? '',
    }));

    // Fase 2: TCP probe real para impressoras de rede que WMI reportou como 'ready'
    const networkReady = results.filter(
      (r) => r.printer.type === 'network' && r.printer.status === 'ready',
    );

    if (networkReady.length > 0) {
      log.debug(`[Printer] Probing ${networkReady.length} impressora(s) de rede...`);
      await probeNetworkPrinters(networkReady);
    }

    return results.map((r) => r.printer);
  } catch (err) {
    log.warn('[Printer] PowerShell detection failed, trying wmic fallback:', err);
    return detectWindowsPrintersWmic();
  }
}

function mapWindowsStatusWithPnp(printer: Win32PrinterRaw & { PnpStatus?: string }): DetectedPrinter['status'] {
  const isUsb = (printer.PortName ?? '').toUpperCase().startsWith('USB');

  // USB: PnP device status é o mais confiável
  if (isUsb && printer.PnpStatus) {
    if (printer.PnpStatus !== 'OK') return 'offline';
  }

  // WorkOffline flag (definido pelo usuário ou por SNMP em algumas impressoras)
  if (printer.WorkOffline) return 'offline';

  // PrinterStatus do Win32_Printer (NÃO confiável sozinho para rede —
  // o TCP probe em probeNetworkPrinters corrige downstream)
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
      const portName = cols[portIdx]?.trim() ?? '';

      const type = classifyWindowsPrinterType(name, portName);

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

    // TCP probe para network printers no wmic path também
    const networkReady = printers
      .filter((p) => p.type === 'network' && p.status === 'ready')
      .map((printer) => {
        const row = lines.find((l) => l.includes(printer.name));
        const cols = row?.split(',');
        const portName = cols?.[portIdx]?.trim() ?? '';
        return { printer, portName };
      });

    if (networkReady.length > 0) {
      await probeNetworkPrinters(networkReady);
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

    for (const line of lines) {
      const defaultMatch = line.match(/system default destination:\s*(.+)/i);
      if (defaultMatch) {
        defaultPrinter = defaultMatch[1].trim();
      }
    }

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

    // Enriquecer tipo com lpstat -v (URIs)
    try {
      const { stdout: vOut } = await execAsync('lpstat -v 2>/dev/null', {
        timeout: 5_000,
      });

      for (const line of vOut.trim().split('\n')) {
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
      // lpstat -v não é crítico
    }

    // TCP probe para impressoras de rede no Unix
    const networkReady = printers.filter(
      (p) => p.type === 'network' && p.status === 'ready',
    );
    if (networkReady.length > 0) {
      // No Unix, extrair IP da URI (ipp://192.168.1.100:631)
      const probeTargets: Array<{ printer: DetectedPrinter; portName: string }> = [];
      try {
        const { stdout: vOut } = await execAsync('lpstat -v 2>/dev/null', {
          timeout: 5_000,
        });
        for (const nr of networkReady) {
          const line = vOut.split('\n').find((l) => l.includes(nr.name));
          if (line) {
            const uriMatch = line.match(/:\/\/([^:/]+)/);
            if (uriMatch) {
              probeTargets.push({ printer: nr, portName: uriMatch[1] });
            }
          }
        }
      } catch {
        // Sem probe no Unix se lpstat falhar
      }
      if (probeTargets.length > 0) {
        await probeNetworkPrinters(probeTargets);
      }
    }

    return printers;
  } catch (err) {
    log.error('[Printer] lpstat failed:', err);
    return [];
  }
}
