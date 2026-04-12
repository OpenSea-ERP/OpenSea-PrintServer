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
} from 'lucide-react';
import { StatusDot } from '../components/StatusDot';
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

  if (
    name.includes('pdf') ||
    name.includes('xps') ||
    name.includes('onenote') ||
    name.includes('fax')
  ) {
    return { label: 'Virtual', icon: FileText, color: 'bg-purple-50 text-purple-700 border-purple-200' };
  }
  if (name.includes('network') || name.includes('\\\\') || name.includes('tcp')) {
    return { label: 'Rede', icon: Globe, color: 'bg-sky-50 text-sky-700 border-sky-200' };
  }
  return { label: 'Local', icon: Usb, color: 'bg-gray-50 text-gray-600 border-gray-200' };
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

  const pairedDate = status.pairedAt
    ? new Date(status.pairedAt).toLocaleDateString('pt-BR', {
        day: '2-digit',
        month: 'short',
        year: 'numeric',
      })
    : null;

  const printerList = printers ?? [];

  return (
    <div className="h-full flex flex-col">
      {/* Header */}
      <div className="flex items-center justify-between px-5 py-4 border-b border-gray-100">
        <div className="flex items-center gap-2.5">
          <div className="h-8 w-8 rounded-lg bg-gradient-to-br from-blue-500 to-indigo-600 flex items-center justify-center">
            <Printer className="h-4 w-4 text-white" />
          </div>
          <div>
            <h1 className="text-sm font-bold text-gray-900 leading-none">
              OpenSea Print Server
            </h1>
            <div className="flex items-center gap-1.5 mt-1">
              <StatusDot
                status={status.connected ? 'online' : 'offline'}
                size="sm"
                pulse={status.connected}
              />
              <span className={`text-xs font-medium ${status.connected ? 'text-emerald-600' : 'text-gray-400'}`}>
                {status.connected ? 'Conectado' : 'Desconectado'}
              </span>
            </div>
          </div>
        </div>
      </div>

      {/* Content */}
      <div className="flex-1 overflow-y-auto px-5 py-4 space-y-4">
        {/* Agent Info Card */}
        <div className="bg-white rounded-xl border border-gray-200 shadow-sm p-4">
          <div className="flex items-center gap-3 mb-3">
            <div className="h-9 w-9 rounded-lg bg-blue-50 flex items-center justify-center">
              <Monitor className="h-4 w-4 text-blue-600" />
            </div>
            <div className="flex-1 min-w-0">
              <h3 className="text-sm font-semibold text-gray-900 truncate">
                {status.computerName || 'Computador'}
              </h3>
              <p className="text-xs text-gray-400">
                {status.agentId ? `ID: ${status.agentId.slice(0, 8)}...` : 'Agente local'}
              </p>
            </div>
            <div className={`h-8 w-8 rounded-lg flex items-center justify-center ${
              status.connected ? 'bg-emerald-50' : 'bg-gray-50'
            }`}>
              {status.connected ? (
                <Wifi className="h-4 w-4 text-emerald-500" />
              ) : (
                <WifiOff className="h-4 w-4 text-gray-400" />
              )}
            </div>
          </div>
          <div className="flex items-center gap-4 text-xs text-gray-500">
            {status.ipAddress && (
              <div className="flex items-center gap-1">
                <Network className="h-3 w-3" />
                <span>{status.ipAddress}</span>
              </div>
            )}
            {pairedDate && (
              <span>Vinculado em {pairedDate}</span>
            )}
          </div>
        </div>

        {/* Printers Section */}
        <div>
          <div className="flex items-center justify-between mb-3">
            <div className="flex items-center gap-2">
              <h2 className="text-sm font-semibold text-gray-900">
                Impressoras Detectadas
              </h2>
              {!printersLoading && (
                <span className="inline-flex items-center justify-center h-5 min-w-5 px-1.5 rounded-full bg-blue-100 text-blue-700 text-xs font-bold">
                  {printerList.length}
                </span>
              )}
            </div>
            <button
              onClick={handleRefreshPrinters}
              disabled={refreshing}
              className="
                h-8 px-3 flex items-center gap-1.5
                text-xs font-medium text-gray-600
                bg-white border border-gray-200 rounded-lg
                hover:bg-gray-50 active:bg-gray-100
                disabled:opacity-50 disabled:pointer-events-none
                transition-colors
              "
            >
              <RefreshCw className={`h-3 w-3 ${refreshing ? 'animate-spin' : ''}`} />
              Verificar
            </button>
          </div>

          {/* Printer List */}
          {printersLoading ? (
            <div className="bg-white rounded-xl border border-gray-200 p-8 flex items-center justify-center">
              <div className="h-5 w-5 rounded-full border-2 border-gray-200 border-t-blue-600 animate-spin" />
            </div>
          ) : printerList.length === 0 ? (
            <div className="bg-white rounded-xl border border-gray-200 p-8 text-center">
              <Printer className="h-8 w-8 text-gray-300 mx-auto mb-2" />
              <p className="text-sm text-gray-500">Nenhuma impressora detectada</p>
              <p className="text-xs text-gray-400 mt-1">
                Verifique se as impressoras estão instaladas no sistema
              </p>
            </div>
          ) : (
            <div className="bg-white rounded-xl border border-gray-200 shadow-sm divide-y divide-gray-100">
              {printerList.map((printer) => {
                const badge = getPrinterTypeBadge(printer);
                const BadgeIcon = badge.icon;
                return (
                  <div
                    key={printer.name}
                    className="flex items-center gap-3 px-4 py-3"
                  >
                    <div className="h-8 w-8 rounded-lg bg-gray-50 flex items-center justify-center flex-shrink-0">
                      <Printer className="h-4 w-4 text-gray-500" />
                    </div>
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-2">
                        <span className="text-sm font-medium text-gray-900 truncate">
                          {printer.displayName || printer.name}
                        </span>
                        {printer.isDefault && (
                          <span className="inline-flex items-center h-5 px-1.5 rounded text-xs font-semibold bg-blue-50 text-blue-700 border border-blue-200 flex-shrink-0">
                            Padrão
                          </span>
                        )}
                      </div>
                      <div className="flex items-center gap-2 mt-0.5">
                        <span className={`inline-flex items-center gap-1 h-4 px-1.5 rounded text-[10px] font-medium border ${badge.color}`}>
                          <BadgeIcon className="h-2.5 w-2.5" />
                          {badge.label}
                        </span>
                      </div>
                    </div>
                    <StatusDot
                      status={printer.status === 0 ? 'online' : 'warning'}
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
      <div className="flex items-center gap-2 px-5 py-3 border-t border-gray-100 bg-white">
        <button
          onClick={onOpenSettings}
          className="
            flex-1 h-9 flex items-center justify-center gap-1.5
            text-xs font-medium text-gray-700
            bg-gray-50 border border-gray-200 rounded-lg
            hover:bg-gray-100 active:bg-gray-200
            transition-colors
          "
        >
          <Settings className="h-3.5 w-3.5" />
          Configurações
        </button>
        <button
          onClick={handleUnpair}
          className={`
            flex-1 h-9 flex items-center justify-center gap-1.5
            text-xs font-medium rounded-lg border
            transition-all duration-200
            ${
              unpairConfirm
                ? 'bg-rose-50 border-rose-200 text-rose-700 hover:bg-rose-100'
                : 'bg-gray-50 border-gray-200 text-gray-700 hover:bg-gray-100'
            }
          `}
        >
          <Unlink className="h-3.5 w-3.5" />
          {unpairConfirm ? 'Confirmar?' : 'Desvincular'}
        </button>
      </div>
    </div>
  );
}
