import { spawn } from 'child_process';
import log from 'electron-log';

// ── Types ────────────────────────────────────────────────────────────────────

export interface PrintJob {
  id: number;
  documentName: string;
  userName: string;
  submittedAt: string;
  status: 'printing' | 'queued' | 'paused' | 'error' | 'deleting';
  totalPages: number;
  pagesPrinted: number;
  sizeBytes: number;
}

type ManageAction = 'restart' | 'pause' | 'resume' | 'clear-all';

const CMD_TIMEOUT_MS = 10_000;
const KILL_GRACE_MS = 1_000;

// ── Public API ───────────────────────────────────────────────────────────────

export async function getJobs(printerName: string): Promise<PrintJob[]> {
  if (!printerName) return [];

  switch (process.platform) {
    case 'win32':
      return getJobsWindows(printerName);
    case 'darwin':
    case 'linux':
      return getJobsUnix(printerName);
    default:
      return [];
  }
}

export async function cancelJob(
  printerName: string,
  jobId: number,
): Promise<{ success: boolean; error?: string }> {
  try {
    switch (process.platform) {
      case 'win32':
        await runChild(
          'powershell',
          [
            '-NoProfile',
            '-NonInteractive',
            '-Command',
            'Remove-PrintJob -PrinterName $args[0] -ID $args[1] -ErrorAction Stop',
            '-args',
            printerName,
            String(jobId),
          ],
          CMD_TIMEOUT_MS,
        );
        break;
      case 'darwin':
      case 'linux':
        await runChild('cancel', [String(jobId)], CMD_TIMEOUT_MS);
        break;
      default:
        return { success: false, error: 'Plataforma não suportada' };
    }
    log.info(`[Queue] Job ${jobId} cancelado em "${printerName}"`);
    return { success: true };
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    log.error(`[Queue] Falha ao cancelar job ${jobId}:`, msg);
    return { success: false, error: msg };
  }
}

export async function manageJob(
  printerName: string,
  jobId: number,
  action: ManageAction,
): Promise<{ success: boolean; error?: string }> {
  try {
    switch (process.platform) {
      case 'win32':
        await manageJobWindows(printerName, jobId, action);
        break;
      case 'darwin':
      case 'linux':
        await manageJobUnix(printerName, jobId, action);
        break;
      default:
        return { success: false, error: 'Plataforma não suportada' };
    }
    log.info(`[Queue] Ação "${action}" executada em job ${jobId} / "${printerName}"`);
    return { success: true };
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    log.error(`[Queue] Falha na ação "${action}" job ${jobId}:`, msg);
    return { success: false, error: msg };
  }
}

// ── Windows ──────────────────────────────────────────────────────────────────

async function getJobsWindows(printerName: string): Promise<PrintJob[]> {
  const psCommand = [
    '$jobs = Get-PrintJob -PrinterName $args[0] -ErrorAction SilentlyContinue |',
    'Select-Object Id, DocumentName, UserName, SubmittedTime, JobStatus, Size, TotalPages, PagesPrinted;',
    'if ($jobs) { $jobs | ConvertTo-Json -Compress } else { "[]" }',
  ].join(' ');

  const result = await runChild(
    'powershell',
    ['-NoProfile', '-NonInteractive', '-Command', psCommand, '-args', printerName],
    CMD_TIMEOUT_MS,
  );

  if (!result.stdout?.trim() || result.stdout.trim() === '[]') return [];

  try {
    const raw = JSON.parse(result.stdout.trim());
    const items = Array.isArray(raw) ? raw : [raw];

    return items
      .filter((j: Record<string, unknown>) => j && typeof j.Id === 'number')
      .map((j: Record<string, unknown>) => ({
        id: j.Id as number,
        documentName: String(j.DocumentName ?? 'Sem nome'),
        userName: String(j.UserName ?? ''),
        submittedAt: parseWindowsDate(j.SubmittedTime),
        status: mapWindowsJobStatus(String(j.JobStatus ?? '')),
        totalPages: Number(j.TotalPages ?? 0),
        pagesPrinted: Number(j.PagesPrinted ?? 0),
        sizeBytes: Number(j.Size ?? 0),
      }));
  } catch (err) {
    log.warn('[Queue] Falha ao parsear jobs do PowerShell:', err);
    return [];
  }
}

function parseWindowsDate(raw: unknown): string {
  if (!raw) return new Date().toISOString();
  // PowerShell Date pode vir como "/Date(1234567890000)/" ou string ISO
  const str = String(raw);
  const match = str.match(/\/Date\((\d+)\)\//);
  if (match) {
    return new Date(Number(match[1])).toISOString();
  }
  try {
    return new Date(str).toISOString();
  } catch {
    return new Date().toISOString();
  }
}

function mapWindowsJobStatus(status: string): PrintJob['status'] {
  const lower = status.toLowerCase();
  if (lower.includes('print') || lower.includes('spool')) return 'printing';
  if (lower.includes('paus')) return 'paused';
  if (lower.includes('error') || lower.includes('fail') || lower.includes('blocked'))
    return 'error';
  if (lower.includes('delet')) return 'deleting';
  return 'queued';
}

async function manageJobWindows(
  printerName: string,
  jobId: number,
  action: ManageAction,
): Promise<void> {
  let command: string;

  switch (action) {
    case 'restart':
      command = 'Restart-PrintJob -PrinterName $args[0] -ID $args[1] -ErrorAction Stop';
      break;
    case 'pause':
      command = 'Suspend-PrintJob -PrinterName $args[0] -ID $args[1] -ErrorAction Stop';
      break;
    case 'resume':
      command = 'Resume-PrintJob -PrinterName $args[0] -ID $args[1] -ErrorAction Stop';
      break;
    case 'clear-all':
      command =
        'Get-PrintJob -PrinterName $args[0] -ErrorAction SilentlyContinue | Remove-PrintJob -ErrorAction SilentlyContinue';
      break;
    default:
      throw new Error(`Ação desconhecida: ${action}`);
  }

  const result = await runChild(
    'powershell',
    ['-NoProfile', '-NonInteractive', '-Command', command, '-args', printerName, String(jobId)],
    CMD_TIMEOUT_MS,
  );

  if (!result.success && result.stderr) {
    throw new Error(result.stderr.trim());
  }
}

// ── Unix (CUPS) ──────────────────────────────────────────────────────────────

async function getJobsUnix(printerName: string): Promise<PrintJob[]> {
  const result = await runChild('lpq', ['-P', printerName], CMD_TIMEOUT_MS);

  if (!result.success || !result.stdout?.trim()) return [];

  const lines = result.stdout.trim().split('\n');
  const jobs: PrintJob[] = [];

  // lpq output: "Rank    Owner   Job     File(s)                         Total Size"
  for (const line of lines) {
    const match = line.match(/^(\S+)\s+(\S+)\s+(\d+)\s+(.+?)\s+(\d+)\s+bytes/);
    if (!match) continue;

    const rank = match[1].toLowerCase();
    jobs.push({
      id: Number(match[3]),
      documentName: match[4].trim(),
      userName: match[2],
      submittedAt: new Date().toISOString(),
      status: rank === 'active' ? 'printing' : 'queued',
      totalPages: 0,
      pagesPrinted: 0,
      sizeBytes: Number(match[5]),
    });
  }

  return jobs;
}

async function manageJobUnix(
  printerName: string,
  jobId: number,
  action: ManageAction,
): Promise<void> {
  switch (action) {
    case 'restart':
      await runChild('lp', ['-i', String(jobId), '-H', 'restart'], CMD_TIMEOUT_MS);
      break;
    case 'pause':
      await runChild('lp', ['-i', String(jobId), '-H', 'hold'], CMD_TIMEOUT_MS);
      break;
    case 'resume':
      await runChild('lp', ['-i', String(jobId), '-H', 'resume'], CMD_TIMEOUT_MS);
      break;
    case 'clear-all':
      await runChild('cancel', ['-a', printerName], CMD_TIMEOUT_MS);
      break;
    default:
      throw new Error(`Ação desconhecida: ${action}`);
  }
}

// ── spawn helper ─────────────────────────────────────────────────────────────

interface ChildResult {
  success: boolean;
  stdout?: string;
  stderr?: string;
}

function runChild(command: string, args: string[], timeoutMs: number): Promise<ChildResult> {
  return new Promise((resolve) => {
    let stdout = '';
    let stderr = '';
    let settled = false;

    const child = spawn(command, args, { windowsHide: true, shell: false });

    const timeout = setTimeout(() => {
      if (settled) return;
      child.kill('SIGTERM');
      setTimeout(() => {
        if (!child.killed)
          try {
            child.kill('SIGKILL');
          } catch {
            /* noop */
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
      resolve({ success: false, stderr: err.message });
    });

    child.on('close', (code) => {
      if (settled) return;
      settled = true;
      clearTimeout(timeout);
      resolve({ success: code === 0, stdout, stderr });
    });
  });
}
