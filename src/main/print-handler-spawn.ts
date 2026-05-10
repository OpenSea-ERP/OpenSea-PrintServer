/**
 * Shared `child_process.spawn` helper for the platform-specific print
 * handlers. Returns a structured result instead of throwing so callers
 * can decide whether to retry, fall back, or fail loud.
 *
 * `shell:false` is intentional and load-bearing — it disables shell
 * interpolation, which together with passing args as an array eliminates
 * the entire command-injection vector even when `printerName` carries
 * spaces or quotes.
 */

import { spawn } from 'child_process';
import log from 'electron-log';

const KILL_GRACE_MS = 1_000;

export interface ChildResult {
  success: boolean;
  stdout?: string;
  stderr?: string;
  error?: string;
}

export function runChild(command: string, args: string[], timeoutMs: number): Promise<ChildResult> {
  return new Promise((resolve) => {
    let stdout = '';
    let stderr = '';
    let settled = false;

    const child = spawn(command, args, {
      windowsHide: true,
      shell: false,
    });

    const timeout = setTimeout(() => {
      if (settled) return;
      log.warn(`[Print] Timeout ${timeoutMs}ms — matando processo ${command}`);
      child.kill('SIGTERM');
      setTimeout(() => {
        if (!child.killed) {
          try {
            child.kill('SIGKILL');
          } catch {
            // noop
          }
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
        resolve({
          success: false,
          error: `Morto por timeout (${signal})`,
          stdout,
          stderr,
        });
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
