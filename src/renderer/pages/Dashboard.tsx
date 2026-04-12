import { useState, useCallback } from 'react';
import {
  Monitor,
  Network,
  Printer,
  RefreshCw,
  Settings,
  Unlink,
  Wifi,
  WifiOff,
  Usb,
  Globe,
  FileText,
  Waves,
} from 'lucide-react';
import { StatusDot } from '../components/StatusDot';
import { cn } from '../utils';
import { useIpc, invokeIpc } from '../hooks/useIpc';
import type { AgentStatus, PrinterInfo } from '../preload';

interface DashboardProps {
  status: AgentStatus;
  onRefreshStatus: () => void;
  onOpenSettings: () => void;
  onUnpair: () => void;
}

function getPrinterTypeBadge(printer: PrinterInfo) {
  const name = (printer.name + ' ' + (printer.description || '')).toLowerCase();
  if (name.includes('pdf') || name.includes('xps') || name.includes('onenote') || name.includes('fax')) {
    return { label: 'Virtual', icon: FileText, color: 'bg-violet-500/10 text-violet-400 border-violet-500/20' };
  }
  if (name.includes('network') || name.includes('\\\\') || name.includes('tcp')) {
    return { label: 'Rede', icon: Globe, color: 'bg-sky-500/10 text-sky-400 border-sky-500/20' };
  }
  return { label: 'Local', icon: Usb, color: 'bg-slate-500/10 text-slate-400 border-slate-500/20' };
}

export function Dashboard({ status, onRefreshStatus, onOpenSettings, onUnpair }: DashboardProps) {
  const {
    data: printers,
    loading: printersLoading,
    refetch: refetchPrinters,
  } = useIpc<PrinterInfo[]>('printers:list');

  const [refreshing, setRefreshing] = useState(false);
  const [unpairConfirm, setUnpairConfirm] = useState(false);

  const handleRefreshPrinters = useCallback(async () => {
    setRefreshing(true);
    await refetchPrinters();
    setTimeout(() => setRefreshing(false), 600);
  }, [refetchPrinters]);

  const handleUnpair = useCallback(async () => {
    if (!unpairConfirm) {
      setUnpairConfirm(true);
      setTimeout(() => setUnpairConfirm(false), 3000);
      return;
    }
    try {
      await invokeIpc('agent:unpair');
      onUnpair();
    } catch {
      // ignore
    }
  }, [unpairConfirm, onUnpair]);

  const printerList = printers ?? [];

  return (
    <div className="h-full flex flex-col">
      {/* Header */}
      <div className="flex items-center justify-between px-5 py-4 border-b border-slate-800">
        <div className="flex items-center gap-2.5">
          <div className="h-8 w-8 rounded-lg bg-gradient-to-br from-blue-500 to-indigo-600 flex items-center justify-center">
            <Waves className="h-4 w-4 text-white" strokeWidth={2} />
          </div>
          <div>
            <h1 className="text-sm font-bold text-slate-100 leading-none">
              OpenSea Print Server
            </h1>
            <div className="flex items-center gap-1.5 mt-1">
              <StatusDot
                status={status.connected ? 'online' : 'offline'}
                size="sm"
                pulse={status.connected}
              />
              <span className={cn('text-xs font-medium', status.connected ? 'text-emerald-400' : 'text-slate-500')}>
                {status.connected ? 'Conectado' : 'Desconectado'}
              </span>
            </div>
          </div>
        </div>
      </div>

      {/* Content */}
      <div className="flex-1 overflow-y-auto px-5 py-4 space-y-4">
        {/* Agent Info Card */}
        <div className="bg-slate-800/60 rounded-xl border border-slate-700/50 p-4">
          <div className="flex items-center gap-3 mb-3">
            <div className="h-9 w-9 rounded-lg bg-blue-500/10 border border-blue-500/20 flex items-center justify-center">
              <Monitor className="h-4 w-4 text-blue-400" />
            </div>
            <div className="flex-1 min-w-0">
              <h3 className="text-sm font-semibold text-slate-200 truncate">
                {status.computerName || 'Computador'}
              </h3>
              <p className="text-xs text-slate-500">
                {status.agentId ? `ID: ${status.agentId.slice(0, 8)}...` : 'Agente local'}
              </p>
            </div>
            <div className={cn(
              'h-8 w-8 rounded-lg flex items-center justify-center border',
              status.connected
                ? 'bg-emerald-500/10 border-emerald-500/20'
                : 'bg-slate-700/50 border-slate-600/50',
            )}>
              {status.connected ? (
                <Wifi className="h-4 w-4 text-emerald-400" />
              ) : (
                <WifiOff className="h-4 w-4 text-slate-500" />
              )}
            </div>
          </div>
          {status.ipAddress && (
            <div className="flex items-center gap-1 text-xs text-slate-500">
              <Network className="h-3 w-3" />
              <span>{status.ipAddress}</span>
            </div>
          )}
        </div>

        {/* Printers Section */}
        <div>
          <div className="flex items-center justify-between mb-3">
            <div className="flex items-center gap-2">
              <h2 className="text-sm font-semibold text-slate-200">
                Impressoras Detectadas
              </h2>
              {!printersLoading && (
                <span className="inline-flex items-center justify-center h-5 min-w-5 px-1.5 rounded-full bg-blue-500/10 text-blue-400 border border-blue-500/20 text-xs font-bold">
                  {printerList.length}
                </span>
              )}
            </div>
            <button
              onClick={handleRefreshPrinters}
              disabled={refreshing}
              className="
                h-8 px-3 flex items-center gap-1.5
                text-xs font-medium text-slate-400
                bg-slate-800/60 border border-slate-700/50 rounded-lg
                hover:bg-slate-800 hover:border-slate-600 hover:text-slate-300
                disabled:opacity-50 disabled:pointer-events-none
                transition-colors
              "
            >
              <RefreshCw className={cn('h-3 w-3', refreshing && 'animate-spin')} />
              Verificar
            </button>
          </div>

          {printersLoading ? (
            <div className="bg-slate-800/60 rounded-xl border border-slate-700/50 p-8 flex items-center justify-center">
              <div className="h-5 w-5 rounded-full border-2 border-slate-700 border-t-blue-500 animate-spin" />
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
                const badge = getPrinterTypeBadge(printer);
                const BadgeIcon = badge.icon;
                return (
                  <div key={printer.name} className="flex items-center gap-3 px-4 py-3">
                    <div className="h-8 w-8 rounded-lg bg-slate-700/50 flex items-center justify-center flex-shrink-0">
                      <Printer className="h-4 w-4 text-slate-400" />
                    </div>
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-2">
                        <span className="text-sm font-medium text-slate-200 truncate">
                          {printer.displayName || printer.name}
                        </span>
                        {printer.isDefault && (
                          <span className="inline-flex items-center h-5 px-1.5 rounded text-[10px] font-semibold bg-blue-500/10 text-blue-400 border border-blue-500/20 flex-shrink-0">
                            Padrão
                          </span>
                        )}
                      </div>
                      <div className="flex items-center gap-2 mt-0.5">
                        <span className={cn('inline-flex items-center gap-1 h-4 px-1.5 rounded text-[10px] font-medium border', badge.color)}>
                          <BadgeIcon className="h-2.5 w-2.5" />
                          {badge.label}
                        </span>
                      </div>
                    </div>
                    <StatusDot
                      status={printer.status === 0 ? 'online' : printer.status === 2 ? 'error' : printer.status === 1 ? 'offline' : 'warning'}
                      size="sm"
                    />
                  </div>
                );
              })}
            </div>
          )}
        </div>
      </div>

      {/* Footer */}
      <div className="flex items-center gap-2 px-5 py-3 border-t border-slate-800">
        <button
          onClick={onOpenSettings}
          className="
            flex-1 h-9 flex items-center justify-center gap-1.5
            text-xs font-medium text-slate-300
            bg-slate-800/60 border border-slate-700/50 rounded-lg
            hover:bg-slate-800 hover:border-slate-600
            transition-colors
          "
        >
          <Settings className="h-3.5 w-3.5" />
          Configurações
        </button>
        <button
          onClick={handleUnpair}
          className={cn(
            'flex-1 h-9 flex items-center justify-center gap-1.5',
            'text-xs font-medium rounded-lg border transition-all duration-200',
            unpairConfirm
              ? 'bg-rose-500/10 border-rose-500/20 text-rose-400 hover:bg-rose-500/20'
              : 'bg-slate-800/60 border-slate-700/50 text-slate-300 hover:bg-slate-800 hover:border-slate-600',
          )}
        >
          <Unlink className="h-3.5 w-3.5" />
          {unpairConfirm ? 'Confirmar?' : 'Desvincular'}
        </button>
      </div>
    </div>
  );
}
