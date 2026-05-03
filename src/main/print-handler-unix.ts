/**
 * Unix-side print pipeline (macOS + Linux). Both platforms route through
 * CUPS via `lp -d <queue> -n <copies>`, which accepts PDF, PostScript
 * and raw byte streams transparently. No viewer launch, no window flash.
 */

import { writeFile } from "fs/promises";
import log from "electron-log";
import {
  cleanupTempFile,
  detectFormat,
  getTempFilePath,
} from "./print-handler-format";
import { runChild } from "./print-handler-spawn";
import type { PrintResult } from "./print-handler";

const RAW_TIMEOUT_MS = 30_000;

export async function printUnix(
  jobId: string,
  printerName: string,
  data: Buffer,
  copies: number,
): Promise<PrintResult> {
  const tempPath = getTempFilePath(detectFormat(data));

  try {
    await writeFile(tempPath, data);

    const res = await runChild(
      "lp",
      ["-d", printerName, "-n", String(copies), tempPath],
      RAW_TIMEOUT_MS,
    );

    if (!res.success) {
      return { success: false, error: `lp falhou: ${res.error}` };
    }

    log.info(
      `[Print] Job ${jobId}: enviado via lp — ${res.stdout?.trim() ?? ""}`,
    );
    return { success: true };
  } finally {
    await cleanupTempFile(tempPath);
  }
}
