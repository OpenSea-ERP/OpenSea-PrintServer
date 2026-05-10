/**
 * Windows-side print pipeline. Two paths:
 *
 *   1. SumatraPDF (silent, scriptable, ideal). Tried first when format
 *      is `pdf` because Sumatra is the only viewer on Windows that
 *      reliably prints headlessly without ever flashing a window.
 *   2. PowerShell `Start-Process -Verb PrintTo` fallback. Used when
 *      SumatraPDF is not installed; behavior depends on the user's
 *      default PDF viewer (Adobe Reader / Edge / etc) which may briefly
 *      surface a window. Acceptable degradation but worth a P2 follow-
 *      up to ship Sumatra alongside the installer.
 *
 * Raw byte streams (ESC/POS, ZPL, EPL) bypass viewers entirely and go
 * straight to `Out-Printer -Name`, which writes the bytes verbatim to
 * the Windows printer queue.
 */

import log from 'electron-log';
import { writeFile } from 'fs/promises';
import type { PrintResult } from './print-handler';
import { cleanupTempFile, getTempFilePath, type PrintFormat } from './print-handler-format';
import { runChild } from './print-handler-spawn';

const PDF_TIMEOUT_MS = 60_000;
const RAW_TIMEOUT_MS = 30_000;

export async function printWindows(
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
  // Tenta SumatraPDF primeiro (silent print, leve).
  const sumatraRes = await runChild(
    'SumatraPDF',
    ['-print-to', printerName, '-print-settings', `${copies}x`, '-silent', filePath],
    PDF_TIMEOUT_MS,
  );

  if (sumatraRes.success) {
    log.info(`[Print] Job ${jobId}: enviado via SumatraPDF`);
    return { success: true };
  }

  log.debug(
    `[Print] Job ${jobId}: SumatraPDF indisponível (${sumatraRes.error}), tentando PowerShell PrintTo`,
  );

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
  // Out-Printer aceita nome via -Name; argumentos como array, sem
  // concatenação de string para evitar injeção via printerName.
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
