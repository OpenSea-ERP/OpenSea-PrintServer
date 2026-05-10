import { Loader2, Printer, RefreshCw, Settings, Wifi, WifiOff } from 'lucide-react';
import { useCallback, useEffect, useRef, useState } from 'react';
import { PrintQueueDrawer } from '../components/PrintQueueDrawer';
import { StatusDot } from '../components/StatusDot';
import { invokeIpc, useIpc } from '../hooks/useIpc';
import type { AgentStatus, PrinterInfo, PrintJob } from '../preload';
import { cn } from '../utils';

interface DashboardProps {
  status: AgentStatus;
  onRefreshStatus: () => void;
  onOpenSettings: () => void;
}

export function Dashboard({ status, onOpenSettings }: DashboardProps) {
  const {
    data: printers,
    loading: printersLoading,
    refetch: refetchPrinters,
  } = useIpc<PrinterInfo[]>('printers:list');

  const [refreshing, setRefreshing] = useState(false);
  const [drawerPrinter, setDrawerPrinter] = useState<{
    name: string;
    status: number;
  } | null>(null);

  // Job counts per printer (for subtitle)
  const [jobCounts, setJobCounts] = useState<Record<string, number>>({});
  const jobCountTimerRef = useRef<ReturnType<typeof setInterval> | null>(null);

  const fetchJobCounts = useCallback(async (printerList: PrinterInfo[]) => {
    const counts: Record<string, number> = {};
    await Promise.all(
      printerList
        .filter((p) => p.status === 0) // only online
        .map(async (p) => {
          try {
            const jobs = await invokeIpc<PrintJob[]>('printers:jobs', p.name);
            counts[p.name] = jobs?.length ?? 0;
          } catch {
            counts[p.name] = 0;
          }
        }),
    );
    setJobCounts(counts);
  }, []);

  useEffect(() => {
    const list = printers ?? [];
    if (list.length === 0) return;
    fetchJobCounts(list);
    jobCountTimerRef.current = setInterval(() => fetchJobCounts(list), 10_000);
    return () => {
      if (jobCountTimerRef.current) clearInterval(jobCountTimerRef.current);
    };
  }, [printers, fetchJobCounts]);

  const handleRefreshPrinters = useCallback(async () => {
    setRefreshing(true);
    await refetchPrinters();
    setTimeout(() => setRefreshing(false), 600);
  }, [refetchPrinters]);

  const handlePrinterClick = useCallback((printer: PrinterInfo) => {
    setDrawerPrinter({ name: printer.name, status: printer.status });
  }, []);

  const printerList = printers ?? [];

  return (
    <div className="h-full flex flex-col">
      {/* ── Header ──────────────────────────────────────────────────────── */}
      <div className="px-5 pt-4 pb-3 border-b border-slate-800">
        <div className="flex items-center justify-between">
          {/* Left: icon + title + machine name */}
          <div className="flex items-center gap-2.5">
            <div className="h-9 w-9 rounded-lg bg-gradient-to-br from-blue-500 to-indigo-600 flex items-center justify-center">
              <Printer className="h-4.5 w-4.5 text-white" strokeWidth={2} />
            </div>
            <div>
              <h1 className="text-sm font-bold text-slate-100 leading-none">
                OpenSea Print Server
              </h1>
              <p className="text-xs text-slate-500 mt-0.5">{status.computerName || 'Computador'}</p>
            </div>
          </div>

          {/* Right: settings (icon only) + connection status (icon only) */}
          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={onOpenSettings}
              className="
                h-9 w-9 flex items-center justify-center
                bg-slate-800/60 border border-slate-700/50 rounded-lg
                text-slate-400 hover:text-slate-200 hover:bg-slate-800 hover:border-slate-600
                transition-colors
              "
              title="Configurações"
            >
              <Settings className="h-4 w-4" />
            </button>
            <div
              className={cn(
                'h-9 w-9 flex items-center justify-center rounded-lg border',
                status.connected
                  ? 'bg-emerald-500/10 border-emerald-500/20 text-emerald-400'
                  : 'bg-slate-800/60 border-slate-700/50 text-slate-500',
              )}
              title={status.connected ? 'Conectado' : 'Desconectado'}
            >
              {status.connected ? <Wifi className="h-4 w-4" /> : <WifiOff className="h-4 w-4" />}
            </div>
          </div>
        </div>

        {/* Divider between app header and list header */}
        <div className="h-px bg-slate-800 -mx-5 mt-3" />

        {/* Sub-header: detected printers count + verify button — aligned center */}
        <div className="flex items-center justify-between mt-3 pb-0">
          <div className="flex items-center gap-2">
            <h2 className="text-sm font-semibold text-slate-200 leading-none">
              Impressoras Detectadas
            </h2>
            {!printersLoading && (
              <span className="inline-flex items-center justify-center h-5 min-w-5 px-1.5 rounded-full bg-blue-500/10 text-blue-400 border border-blue-500/20 text-xs font-bold leading-none">
                {printerList.length}
              </span>
            )}
          </div>
          <button
            type="button"
            onClick={handleRefreshPrinters}
            disabled={refreshing}
            className="
              h-8 w-8 flex items-center justify-center
              text-slate-400
              bg-slate-800/60 border border-slate-700/50 rounded-lg
              hover:bg-slate-800 hover:border-slate-600 hover:text-slate-300
              disabled:opacity-50 disabled:pointer-events-none
              transition-colors
            "
            title="Atualizar lista"
          >
            <RefreshCw className={cn('h-3.5 w-3.5', refreshing && 'animate-spin')} />
          </button>
        </div>
      </div>

      {/* ── Printer List (scroll) ───────────────────────────────────────── */}
      <div className="flex-1 overflow-y-auto px-5 py-3">
        {printersLoading ? (
          <div className="flex items-center justify-center h-32">
            <Loader2 className="h-5 w-5 text-slate-600 animate-spin" />
          </div>
        ) : printerList.length === 0 ? (
          <div className="bg-slate-800/60 rounded-xl border border-slate-700/50 p-8 text-center">
            <Printer className="h-8 w-8 text-slate-600 mx-auto mb-2" />
            <p className="text-sm text-slate-400">Nenhuma impressora detectada</p>
            <p className="text-xs text-slate-600 mt-1">
              Verifique se as impressoras estão instaladas no sistema
            </p>
          </div>
        ) : (
          <div className="bg-slate-800/60 rounded-xl border border-slate-700/50 divide-y divide-slate-700/50">
            {printerList.map((printer) => {
              const isOnline = printer.status === 0;
              const count = jobCounts[printer.name];
              const subtitle = !isOnline
                ? 'Offline'
                : count === undefined
                  ? 'Verificando fila...'
                  : count === 0
                    ? 'Fila vazia'
                    : `${count} documento${count !== 1 ? 's' : ''} na fila`;

              return (
                <div
                  key={printer.name}
                  className="flex items-center gap-3 px-4 py-3 cursor-pointer hover:bg-slate-700/30 transition-colors select-none"
                  onClick={() => handlePrinterClick(printer)}
                  title="Clique para ver a fila de impressão"
                >
                  <div
                    className={cn(
                      'h-9 w-9 rounded-lg flex items-center justify-center flex-shrink-0',
                      isOnline
                        ? 'bg-blue-500/10 border border-blue-500/20'
                        : 'bg-slate-700/50 border border-slate-600/30',
                    )}
                  >
                    <Printer
                      className={cn('h-4 w-4', isOnline ? 'text-blue-400' : 'text-slate-500')}
                    />
                  </div>
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2">
                      <span className="text-sm font-medium text-slate-200 truncate">
                        {printer.name}
                      </span>
                      {printer.isDefault && (
                        <span className="inline-flex items-center h-4 px-1.5 rounded text-[10px] font-semibold bg-blue-500/10 text-blue-400 border border-blue-500/20 flex-shrink-0">
                          Padrão
                        </span>
                      )}
                    </div>
                    <p
                      className={cn(
                        'text-xs mt-0.5',
                        !isOnline
                          ? 'text-slate-600'
                          : count && count > 0
                            ? 'text-amber-400/70'
                            : 'text-slate-500',
                      )}
                    >
                      {subtitle}
                    </p>
                  </div>
                  <StatusDot
                    status={
                      isOnline
                        ? 'online'
                        : printer.status === 2
                          ? 'error'
                          : printer.status === 1
                            ? 'offline'
                            : 'warning'
                    }
                    size="sm"
                    pulse={isOnline}
                  />
                </div>
              );
            })}
          </div>
        )}
      </div>

      {/* ── Print Queue Drawer ──────────────────────────────────────────── */}
      <PrintQueueDrawer
        printerName={drawerPrinter?.name ?? ''}
        printerStatus={drawerPrinter?.status ?? 3}
        open={drawerPrinter !== null}
        onClose={() => setDrawerPrinter(null)}
      />
    </div>
  );
}
