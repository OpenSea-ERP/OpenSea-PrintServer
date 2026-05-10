/**
 * Print dispatcher. Validates the inbound job (printer name, copies,
 * non-empty payload), confirms the device exists locally, and routes to
 * the platform-specific implementation in `print-handler-{windows,unix}`.
 *
 * The platform split exists so each implementation can be tested in
 * isolation against its own runChild mock without dragging the others
 * along — see `print-handler-spawn.ts` for the shared subprocess helper
 * and `print-handler-format.ts` for tempfile + magic-byte detection.
 */

import log from 'electron-log';
import { detectFormat } from './print-handler-format';
import { printUnix } from './print-handler-unix';
import { printWindows } from './print-handler-windows';

export interface PrintResult {
  success: boolean;
  error?: string;
}

const MAX_COPIES = 999;

export async function executePrint(
  jobId: string,
  printerName: string,
  data: Buffer,
  copies: number,
): Promise<PrintResult> {
  log.info(`[Print] Job ${jobId}: ${copies} cop(ies) → "${printerName}" (${data.length} bytes)`);

  if (!Number.isInteger(copies) || copies < 1 || copies > MAX_COPIES) {
    return {
      success: false,
      error: `copies deve estar entre 1 e ${MAX_COPIES}`,
    };
  }

  if (!printerName || typeof printerName !== 'string') {
    return { success: false, error: 'printerName inválido' };
  }

  if (!data || data.length === 0) {
    return { success: false, error: 'data vazio' };
  }

  try {
    const exists = await printerExists(printerName);
    if (!exists) {
      return {
        success: false,
        error: `Impressora "${printerName}" não encontrada no sistema`,
      };
    }

    const format = detectFormat(data);
    log.info(`[Print] Job ${jobId}: formato detectado=${format}`);

    switch (process.platform) {
      case 'win32':
        return await printWindows(jobId, printerName, data, copies, format);
      case 'darwin':
      case 'linux':
        return await printUnix(jobId, printerName, data, copies);
      default:
        return {
          success: false,
          error: `Plataforma não suportada: ${process.platform}`,
        };
    }
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    log.error(`[Print] Job ${jobId}: falha — ${message}`);
    return { success: false, error: message };
  }
}

async function printerExists(printerName: string): Promise<boolean> {
  try {
    const { detectPrinters } = await import('./printer-detector');
    const printers = await detectPrinters();
    return printers.some((p) => p.name === printerName);
  } catch (err) {
    log.warn('[Print] Falha ao verificar impressora (seguindo mesmo assim):', err);
    return true; // fallback: não bloqueia impressão
  }
}
