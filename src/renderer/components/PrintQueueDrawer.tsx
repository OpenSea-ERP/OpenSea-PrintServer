import {
  AlertCircle,
  FileText,
  Loader2,
  Pause,
  Play,
  Printer,
  RotateCcw,
  Trash2,
  X,
} from 'lucide-react';
import { useCallback, useEffect, useRef, useState } from 'react';
import { invokeIpc } from '../hooks/useIpc';
import type { PrintJob } from '../preload';
import { cn } from '../utils';
import { StatusDot } from './StatusDot';

interface PrintQueueDrawerProps {
  printerName: string;
  printerStatus: number; // 0=online, 1=offline, 2=error, 3=unknown
  open: boolean;
  onClose: () => void;
}

const POLL_INTERVAL = 4000;

const STATUS_LABELS: Record<PrintJob['status'], string> = {
  printing: 'Imprimindo',
  queued: 'Na fila',
  paused: 'Pausado',
  error: 'Erro',
  deleting: 'Cancelando',
};

const STATUS_COLORS: Record<PrintJob['status'], string> = {
  printing: 'bg-blue-500/10 text-blue-400 border-blue-500/20',
  queued: 'bg-slate-500/10 text-slate-400 border-slate-500/20',
  paused: 'bg-amber-500/10 text-amber-400 border-amber-500/20',
  error: 'bg-rose-500/10 text-rose-400 border-rose-500/20',
  deleting: 'bg-slate-500/10 text-slate-500 border-slate-500/20',
};

function formatBytes(bytes: number): string {
  if (bytes === 0) return '0 B';
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(0)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

function timeAgo(isoDate: string): string {
  const diff = Date.now() - new Date(isoDate).getTime();
  const seconds = Math.floor(diff / 1000);
  if (seconds < 60) return 'agora';
  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) return `${minutes}min atrás`;
  const hours = Math.floor(minutes / 60);
  return `${hours}h atrás`;
}

export function PrintQueueDrawer({
  printerName,
  printerStatus,
  open,
  onClose,
}: PrintQueueDrawerProps) {
  const [jobs, setJobs] = useState<PrintJob[]>([]);
  const [loading, setLoading] = useState(true);
  const [actionLoading, setActionLoading] = useState<number | null>(null);
  const pollRef = useRef<ReturnType<typeof setInterval> | null>(null);

  const fetchJobs = useCallback(async () => {
    try {
      const result = await invokeIpc<PrintJob[]>('printers:jobs', printerName);
      setJobs(result ?? []);
    } catch {
      setJobs([]);
    } finally {
      setLoading(false);
    }
  }, [printerName]);

  // Polling while open
  useEffect(() => {
    if (!open) return;
    setLoading(true);
    fetchJobs();
    pollRef.current = setInterval(fetchJobs, POLL_INTERVAL);
    return () => {
      if (pollRef.current) clearInterval(pollRef.current);
    };
  }, [open, fetchJobs]);

  const handleCancel = useCallback(
    async (jobId: number) => {
      setActionLoading(jobId);
      try {
        await invokeIpc('printers:cancel-job', printerName, jobId);
        await fetchJobs();
      } catch {
        /* ignore */
      }
      setActionLoading(null);
    },
    [printerName, fetchJobs],
  );

  const handleManage = useCallback(
    async (jobId: number, action: string) => {
      setActionLoading(jobId);
      try {
        await invokeIpc('printers:manage-job', printerName, jobId, action);
        await fetchJobs();
      } catch {
        /* ignore */
      }
      setActionLoading(null);
    },
    [printerName, fetchJobs],
  );

  const handleClearAll = useCallback(async () => {
    setActionLoading(-1);
    try {
      await invokeIpc('printers:manage-job', printerName, 0, 'clear-all');
      await fetchJobs();
    } catch {
      /* ignore */
    }
    setActionLoading(null);
  }, [printerName, fetchJobs]);

  const statusDotMap = (s: number) =>
    s === 0
      ? ('online' as const)
      : s === 2
        ? ('error' as const)
        : s === 1
          ? ('offline' as const)
          : ('warning' as const);

  if (!open) return null;

  return (
    <>
      {/* Backdrop */}
      <div className="fixed inset-0 bg-black/40 z-40 transition-opacity" onClick={onClose} />

      {/* Drawer */}
      <div className="fixed top-0 right-0 bottom-0 w-80 bg-slate-900 border-l border-slate-700/50 z-50 flex flex-col animate-slide-in-right">
        {/* Header */}
        <div className="flex items-center gap-3 px-4 py-3 border-b border-slate-800">
          <div className="h-8 w-8 rounded-lg bg-slate-800 flex items-center justify-center">
            <Printer className="h-4 w-4 text-slate-400" />
          </div>
          <div className="flex-1 min-w-0">
            <h3 className="text-sm font-semibold text-slate-200 truncate">{printerName}</h3>
            <div className="flex items-center gap-1.5 mt-0.5">
              <StatusDot status={statusDotMap(printerStatus)} size="sm" />
              <span className="text-[10px] text-slate-500">
                {printerStatus === 0 ? 'Online' : 'Offline'}
              </span>
            </div>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="h-7 w-7 flex items-center justify-center rounded-lg hover:bg-slate-800 text-slate-500 transition-colors"
          >
            <X className="h-4 w-4" />
          </button>
        </div>

        {/* Toolbar */}
        {jobs.length > 0 && (
          <div className="flex items-center justify-between px-4 py-2 border-b border-slate-800/50">
            <span className="text-xs text-slate-500">
              {jobs.length} documento{jobs.length !== 1 ? 's' : ''} na fila
            </span>
            <button
              type="button"
              onClick={handleClearAll}
              disabled={actionLoading === -1}
              className="
                h-7 px-2 flex items-center gap-1 text-[10px] font-medium
                text-rose-400 bg-rose-500/10 border border-rose-500/20 rounded-md
                hover:bg-rose-500/20 disabled:opacity-50 disabled:pointer-events-none
                transition-colors
              "
            >
              {actionLoading === -1 ? (
                <Loader2 className="h-3 w-3 animate-spin" />
              ) : (
                <Trash2 className="h-3 w-3" />
              )}
              Limpar Fila
            </button>
          </div>
        )}

        {/* Job List */}
        <div className="flex-1 overflow-y-auto">
          {loading ? (
            <div className="flex items-center justify-center h-32">
              <Loader2 className="h-5 w-5 text-slate-600 animate-spin" />
            </div>
          ) : jobs.length === 0 ? (
            <div className="flex flex-col items-center justify-center h-48 text-center px-6">
              <FileText className="h-8 w-8 text-slate-700 mb-2" />
              <p className="text-sm text-slate-400">Nenhum documento na fila</p>
              <p className="text-xs text-slate-600 mt-1">
                Documentos enviados para impressão aparecerão aqui
              </p>
            </div>
          ) : (
            <div className="divide-y divide-slate-800/50">
              {jobs.map((job) => {
                const isActive = actionLoading === job.id;
                return (
                  <div
                    key={job.id}
                    className={cn('px-4 py-3 transition-opacity', isActive && 'opacity-50')}
                  >
                    {/* Job info */}
                    <div className="flex items-start gap-2 mb-2">
                      <div className="flex-1 min-w-0">
                        <p className="text-sm font-medium text-slate-200 truncate">
                          {job.documentName}
                        </p>
                        <div className="flex items-center gap-2 mt-1">
                          <span
                            className={cn(
                              'inline-flex items-center h-4 px-1.5 rounded text-[10px] font-medium border',
                              STATUS_COLORS[job.status],
                            )}
                          >
                            {job.status === 'error' && (
                              <AlertCircle className="h-2.5 w-2.5 mr-0.5" />
                            )}
                            {STATUS_LABELS[job.status]}
                          </span>
                          {job.totalPages > 0 && (
                            <span className="text-[10px] text-slate-600">
                              {job.pagesPrinted}/{job.totalPages} pág.
                            </span>
                          )}
                          <span className="text-[10px] text-slate-600">
                            {formatBytes(job.sizeBytes)}
                          </span>
                        </div>
                      </div>
                    </div>

                    {/* Footer: time + actions */}
                    <div className="flex items-center justify-between">
                      <span className="text-[10px] text-slate-600">
                        {job.userName ? `${job.userName} · ` : ''}
                        {timeAgo(job.submittedAt)}
                      </span>
                      <div className="flex items-center gap-1">
                        {job.status === 'paused' ? (
                          <button
                            type="button"
                            onClick={() => handleManage(job.id, 'resume')}
                            disabled={isActive}
                            className="h-6 w-6 flex items-center justify-center rounded hover:bg-slate-800 text-slate-500 hover:text-emerald-400 transition-colors"
                            title="Retomar"
                          >
                            <Play className="h-3 w-3" />
                          </button>
                        ) : job.status !== 'deleting' ? (
                          <button
                            type="button"
                            onClick={() => handleManage(job.id, 'pause')}
                            disabled={isActive}
                            className="h-6 w-6 flex items-center justify-center rounded hover:bg-slate-800 text-slate-500 hover:text-amber-400 transition-colors"
                            title="Pausar"
                          >
                            <Pause className="h-3 w-3" />
                          </button>
                        ) : null}
                        {job.status === 'error' && (
                          <button
                            type="button"
                            onClick={() => handleManage(job.id, 'restart')}
                            disabled={isActive}
                            className="h-6 w-6 flex items-center justify-center rounded hover:bg-slate-800 text-slate-500 hover:text-blue-400 transition-colors"
                            title="Reenviar"
                          >
                            <RotateCcw className="h-3 w-3" />
                          </button>
                        )}
                        <button
                          type="button"
                          onClick={() => handleCancel(job.id)}
                          disabled={isActive}
                          className="h-6 w-6 flex items-center justify-center rounded hover:bg-slate-800 text-slate-500 hover:text-rose-400 transition-colors"
                          title="Cancelar"
                        >
                          <Trash2 className="h-3 w-3" />
                        </button>
                      </div>
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </div>
      </div>
    </>
  );
}
