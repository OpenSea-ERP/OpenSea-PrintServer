import { exec } from 'child_process';
import { promisify } from 'util';
import { writeFile, unlink } from 'fs/promises';
import { tmpdir } from 'os';
import { join } from 'path';
import { randomUUID } from 'crypto';
import log from 'electron-log';

const execAsync = promisify(exec);

// ── Types ────────────────────────────────────────────────────────────────────

export interface PrintResult {
  success: boolean;
  error?: string;
}

// ── Public API ───────────────────────────────────────────────────────────────

/**
 * Execute a print job by sending data to the specified printer.
 *
 * @param jobId      - Unique job identifier for logging/tracking
 * @param printerName - OS printer name to send the job to
 * @param data       - Raw print data (PDF or raw bytes)
 * @param copies     - Number of copies to print
 */
export async function executePrint(
  jobId: string,
  printerName: string,
  data: Buffer,
  copies: number,
): Promise<PrintResult> {
  log.info(`[Print] Job ${jobId}: printing ${copies} cop(ies) to "${printerName}" (${data.length} bytes)`);

  try {
    if (copies < 1) {
      return { success: false, error: 'Copies must be at least 1' };
    }

    switch (process.platform) {
      case 'win32':
        return await printWindows(jobId, printerName, data, copies);
      case 'darwin':
      case 'linux':
        return await printUnix(jobId, printerName, data, copies);
      default:
        return { success: false, error: `Unsupported platform: ${process.platform}` };
    }
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    log.error(`[Print] Job ${jobId}: failed — ${message}`);
    return { success: false, error: message };
  }
}

// ── Windows ──────────────────────────────────────────────────────────────────

async function printWindows(
  jobId: string,
  printerName: string,
  data: Buffer,
  copies: number,
): Promise<PrintResult> {
  const tempPath = getTempFilePath(data);

  try {
    await writeFile(tempPath, data);

    const isPdf = isPdfData(data);

    if (isPdf) {
      return await printWindowsPdf(jobId, printerName, tempPath, copies);
    }

    return await printWindowsRaw(jobId, printerName, tempPath, copies);
  } finally {
    await cleanupTempFile(tempPath);
  }
}

async function printWindowsPdf(
  jobId: string,
  printerName: string,
  filePath: string,
  copies: number,
): Promise<PrintResult> {
  // Try SumatraPDF first (silent printing, widely used)
  try {
    const sumatraCmd = [
      'SumatraPDF',
      '-print-to', `"${printerName}"`,
      '-print-settings', `"${copies}x"`,
      '-silent',
      `"${filePath}"`,
    ].join(' ');

    await execAsync(sumatraCmd, { timeout: 60_000 });
    log.info(`[Print] Job ${jobId}: sent via SumatraPDF`);
    return { success: true };
  } catch {
    log.debug(`[Print] Job ${jobId}: SumatraPDF not available, trying PowerShell`);
  }

  // Fallback: Start-Process with default PDF handler
  const escapedPrinter = printerName.replace(/'/g, "''");
  const escapedPath = filePath.replace(/'/g, "''");

  for (let i = 0; i < copies; i++) {
    const psCmd = `Start-Process -FilePath '${escapedPath}' -Verb PrintTo -ArgumentList '${escapedPrinter}' -Wait -WindowStyle Hidden`;

    try {
      await execAsync(`powershell -NoProfile -Command "${psCmd}"`, {
        timeout: 60_000,
      });
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      log.error(`[Print] Job ${jobId}: PowerShell PrintTo failed (copy ${i + 1}): ${message}`);
      return { success: false, error: `PrintTo failed on copy ${i + 1}: ${message}` };
    }
  }

  log.info(`[Print] Job ${jobId}: sent via PowerShell PrintTo`);
  return { success: true };
}

async function printWindowsRaw(
  jobId: string,
  printerName: string,
  filePath: string,
  copies: number,
): Promise<PrintResult> {
  const escapedPrinter = printerName.replace(/'/g, "''");
  const escapedPath = filePath.replace(/'/g, "''");

  // Use Out-Printer for raw data
  for (let i = 0; i < copies; i++) {
    const psCmd = `Get-Content -Path '${escapedPath}' -Encoding Byte -Raw | Out-Printer -Name '${escapedPrinter}'`;

    try {
      await execAsync(`powershell -NoProfile -Command "${psCmd}"`, {
        timeout: 30_000,
      });
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      log.error(`[Print] Job ${jobId}: Out-Printer failed (copy ${i + 1}): ${message}`);
      return { success: false, error: `Out-Printer failed on copy ${i + 1}: ${message}` };
    }
  }

  log.info(`[Print] Job ${jobId}: sent via Out-Printer`);
  return { success: true };
}

// ── macOS / Linux (CUPS) ─────────────────────────────────────────────────────

async function printUnix(
  jobId: string,
  printerName: string,
  data: Buffer,
  copies: number,
): Promise<PrintResult> {
  const tempPath = getTempFilePath(data);

  try {
    await writeFile(tempPath, data);

    // lp -d <printer> -n <copies> <file>
    const escapedPrinter = printerName.replace(/'/g, "'\\''");
    const escapedPath = tempPath.replace(/'/g, "'\\''");

    const cmd = `lp -d '${escapedPrinter}' -n ${copies} '${escapedPath}'`;

    const { stdout } = await execAsync(cmd, { timeout: 30_000 });
    log.info(`[Print] Job ${jobId}: sent via lp — ${stdout.trim()}`);

    return { success: true };
  } finally {
    await cleanupTempFile(tempPath);
  }
}

// ── Helpers ──────────────────────────────────────────────────────────────────

function isPdfData(data: Buffer): boolean {
  // PDF magic number: %PDF
  return data.length >= 4 && data[0] === 0x25 && data[1] === 0x50 && data[2] === 0x44 && data[3] === 0x46;
}

function getTempFilePath(data: Buffer): string {
  const ext = isPdfData(data) ? '.pdf' : '.prn';
  return join(tmpdir(), `opensea-print-${randomUUID()}${ext}`);
}

async function cleanupTempFile(filePath: string): Promise<void> {
  try {
    await unlink(filePath);
  } catch {
    // File may have already been cleaned up
  }
}
