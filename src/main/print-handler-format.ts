/**
 * Shared format detection + tempfile helpers for the platform-specific
 * print handlers. Detection is purely structural (magic bytes), so the
 * dispatcher can decide whether to drive a PDF viewer (SumatraPDF) or
 * stream raw bytes straight to the spooler.
 */

import { randomUUID } from 'crypto';
import { unlink } from 'fs/promises';
import { tmpdir } from 'os';
import { join } from 'path';

export type PrintFormat = 'pdf' | 'postscript' | 'raw';

export function detectFormat(data: Buffer): PrintFormat {
  if (
    data.length >= 4 &&
    data[0] === 0x25 &&
    data[1] === 0x50 &&
    data[2] === 0x44 &&
    data[3] === 0x46
  ) {
    return 'pdf'; // %PDF
  }
  if (data.length >= 2 && data[0] === 0x25 && data[1] === 0x21) {
    return 'postscript'; // %!
  }
  return 'raw';
}

export function getTempFilePath(format: PrintFormat): string {
  const ext = format === 'pdf' ? '.pdf' : format === 'postscript' ? '.ps' : '.prn';
  return join(tmpdir(), `opensea-print-${randomUUID()}${ext}`);
}

export async function cleanupTempFile(filePath: string): Promise<void> {
  try {
    await unlink(filePath);
  } catch {
    // já removido
  }
}
