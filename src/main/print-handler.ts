import { spawn } from 'child_process';
import { writeFile, unlink } from 'fs/promises';
import { tmpdir } from 'os';
import { join } from 'path';
import { randomUUID } from 'crypto';
import log from 'electron-log';

// ── Types ────────────────────────────────────────────────────────────────────

export interface PrintResult {
  success: boolean;
  error?: string;
}

type PrintFormat = 'pdf' | 'postscript' | 'raw';

const MAX_COPIES = 999;
const PDF_TIMEOUT_MS = 60_000;
const RAW_TIMEOUT_MS = 30_000;
const KILL_GRACE_MS = 1_000;

// ── Public API ───────────────────────────────────────────────────────────────

/**
 * Executa um job de impressão enviando `data` para a impressora indicada.
 * Validações: impressora existe, copies em [1, 999], formato reconhecido.
 */
export async function executePrint(
  jobId: string,
  printerName: string,
  data: Buffer,
  copies: number,
): Promise<PrintResult> {
  log.info(`[Print] Job ${jobId}: ${copies} cop(ies) → "${printerName}" (${data.length} bytes)`);

  if (!Number.isInteger(copies) || copies < 1 || copies > MAX_COPIES) {
    return { success: false, error: `copies deve estar entre 1 e ${MAX_COPIES}` };
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
      return { success: false, error: `Impressora "${printerName}" não encontrada no sistema` };
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
        return { success: false, error: `Plataforma não suportada: ${process.platform}` };
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

// ── Windows ──────────────────────────────────────────────────────────────────

async function printWindows(
  jobId: string,
  printerName: string,
  data: Buffer,
  copies: number,
  format: PrintFormat,
): Promise<PrintResult> {
  const tempPath = getTempFilePath(format);

  try {
    await writeFile(tempPath, data);

    if (format === 'pdf') {
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
  // Tenta SumatraPDF primeiro (silent print, leve)
  const sumatraRes = await runChild(
    'SumatraPDF',
    ['-print-to', printerName, '-print-settings', `${copies}x`, '-silent', filePath],
    PDF_TIMEOUT_MS,
  );

  if (sumatraRes.success) {
    log.info(`[Print] Job ${jobId}: enviado via SumatraPDF`);
    return { success: true };
  }

  log.debug(`[Print] Job ${jobId}: SumatraPDF indisponível (${sumatraRes.error}), tentando PowerShell PrintTo`);

  for (let i = 0; i < copies; i++) {
    const psResult = await runChild(
      'powershell',
      [
        '-NoProfile',
        '-NonInteractive',
        '-Command',
        `Start-Process -FilePath $args[0] -Verb PrintTo -ArgumentList $args[1] -Wait -WindowStyle Hidden`,
        '-args',
        filePath,
        printerName,
      ],
      PDF_TIMEOUT_MS,
    );

    if (!psResult.success) {
      const msg = `PowerShell PrintTo falhou (cópia ${i + 1}): ${psResult.error}`;
      log.error(`[Print] Job ${jobId}: ${msg}`);
      return { success: false, error: msg };
    }
  }

  log.info(`[Print] Job ${jobId}: enviado via PowerShell PrintTo (${copies} cópias)`);
  return { success: true };
}

async function printWindowsRaw(
  jobId: string,
  printerName: string,
  filePath: string,
  copies: number,
): Promise<PrintResult> {
  // Out-Printer aceita nome via -Name; argumentos como array, sem concatenação de string
  for (let i = 0; i < copies; i++) {
    const res = await runChild(
      'powershell',
      [
        '-NoProfile',
        '-NonInteractive',
        '-Command',
        'Get-Content -Path $args[0] -Encoding Byte -Raw | Out-Printer -Name $args[1]',
        '-args',
        filePath,
        printerName,
      ],
      RAW_TIMEOUT_MS,
    );

    if (!res.success) {
      const msg = `Out-Printer falhou (cópia ${i + 1}): ${res.error}`;
      log.error(`[Print] Job ${jobId}: ${msg}`);
      return { success: false, error: msg };
    }
  }

  log.info(`[Print] Job ${jobId}: enviado via Out-Printer`);
  return { success: true };
}

// ── macOS / Linux (CUPS) ─────────────────────────────────────────────────────

async function printUnix(
  jobId: string,
  printerName: string,
  data: Buffer,
  copies: number,
): Promise<PrintResult> {
  const tempPath = getTempFilePath(detectFormat(data));

  try {
    await writeFile(tempPath, data);

    const res = await runChild(
      'lp',
      ['-d', printerName, '-n', String(copies), tempPath],
      RAW_TIMEOUT_MS,
    );

    if (!res.success) {
      return { success: false, error: `lp falhou: ${res.error}` };
    }

    log.info(`[Print] Job ${jobId}: enviado via lp — ${res.stdout?.trim() ?? ''}`);
    return { success: true };
  } finally {
    await cleanupTempFile(tempPath);
  }
}

// ── spawn helper com kill forçado ────────────────────────────────────────────

interface ChildResult {
  success: boolean;
  stdout?: string;
  stderr?: string;
  error?: string;
}

function runChild(command: string, args: string[], timeoutMs: number): Promise<ChildResult> {
  return new Promise((resolve) => {
    let stdout = '';
    let stderr = '';
    let settled = false;

    const child = spawn(command, args, {
      windowsHide: true,
      shell: false, // crítico: sem shell, argumentos não sofrem interpolação
    });

    const timeout = setTimeout(() => {
      if (settled) return;
      log.warn(`[Print] Timeout ${timeoutMs}ms — matando processo ${command}`);
      child.kill('SIGTERM');
      setTimeout(() => {
        if (!child.killed) {
          try { child.kill('SIGKILL'); } catch { /* noop */ }
        }
      }, KILL_GRACE_MS);
    }, timeoutMs);

    child.stdout?.on('data', (buf) => {
      stdout += buf.toString();
    });

    child.stderr?.on('data', (buf) => {
      stderr += buf.toString();
    });

    child.on('error', (err) => {
      if (settled) return;
      settled = true;
      clearTimeout(timeout);
      resolve({ success: false, error: err.message });
    });

    child.on('close', (code, signal) => {
      if (settled) return;
      settled = true;
      clearTimeout(timeout);

      if (signal === 'SIGTERM' || signal === 'SIGKILL') {
        resolve({ success: false, error: `Morto por timeout (${signal})`, stdout, stderr });
        return;
      }

      if (code !== 0) {
        resolve({
          success: false,
          error: `Exit code ${code}${stderr ? `: ${stderr.trim()}` : ''}`,
          stdout,
          stderr,
        });
        return;
      }

      resolve({ success: true, stdout, stderr });
    });
  });
}

// ── Helpers ──────────────────────────────────────────────────────────────────

function detectFormat(data: Buffer): PrintFormat {
  if (data.length >= 4 && data[0] === 0x25 && data[1] === 0x50 && data[2] === 0x44 && data[3] === 0x46) {
    return 'pdf'; // %PDF
  }
  if (data.length >= 2 && data[0] === 0x25 && data[1] === 0x21) {
    return 'postscript'; // %!
  }
  return 'raw';
}

function getTempFilePath(format: PrintFormat): string {
  const ext = format === 'pdf' ? '.pdf' : format === 'postscript' ? '.ps' : '.prn';
  return join(tmpdir(), `opensea-print-${randomUUID()}${ext}`);
}

async function cleanupTempFile(filePath: string): Promise<void> {
  try {
    await unlink(filePath);
  } catch {
    // Já removido
  }
}
