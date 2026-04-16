import { useState, useEffect, useCallback } from 'react';
import { ArrowLeft, Download, Printer, RefreshCw, Unlink } from 'lucide-react';
import { Toggle } from '../components/Toggle';
import { cn } from '../utils';
import { invokeIpc, useIpcEvent } from '../hooks/useIpc';
import type { UpdateStatus } from '../preload';

interface SettingsProps {
  onBack: () => void;
  onUnpair: () => void;
}

export function Settings({ onBack, onUnpair }: SettingsProps) {
  const [autoLaunch, setAutoLaunch] = useState(false);
  const [minimizeToTray, setMinimizeToTray] = useState(true);
  const [loadingSettings, setLoadingSettings] = useState(true);
  const [updateStatus, setUpdateStatus] = useState<UpdateStatus>({ status: 'not-available' });
  const [checkingUpdate, setCheckingUpdate] = useState(false);
  const [version, setVersion] = useState('1.0.0');
  const [unpairConfirm, setUnpairConfirm] = useState(false);

  useEffect(() => {
    invokeIpc<string>('app:get-version').then((v) => setVersion(v)).catch(() => {});
  }, []);

  useEffect(() => {
    (async () => {
      try {
        const enabled = await invokeIpc<boolean>('auto-launch:is-enabled');
        setAutoLaunch(enabled);
        const mtVal = await invokeIpc<boolean>('store:get', 'minimizeToTray');
        setMinimizeToTray(mtVal ?? true);
      } catch {
        // defaults
      } finally {
        setLoadingSettings(false);
      }
    })();
  }, []);

  const handleToggleAutoLaunch = useCallback(async (val: boolean) => {
    setAutoLaunch(val);
    try {
      await invokeIpc('auto-launch:toggle');
    } catch {
      setAutoLaunch(!val);
    }
  }, []);

  const handleToggleMinimize = useCallback(async (val: boolean) => {
    setMinimizeToTray(val);
    try {
      await invokeIpc('store:set', 'minimizeToTray', val);
    } catch {
      setMinimizeToTray(!val);
    }
  }, []);

  useIpcEvent<UpdateStatus>('updater:status', useCallback((data: UpdateStatus) => {
    const mapped = data.status === 'up-to-date' ? 'not-available' : data.status;
    setUpdateStatus({ ...data, status: mapped as UpdateStatus['status'] });
    if (mapped !== 'checking' && mapped !== 'downloading') {
      setCheckingUpdate(false);
    }
  }, []));

  const handleCheckUpdate = useCallback(async () => {
    setCheckingUpdate(true);
    setUpdateStatus({ status: 'checking' });
    try {
      await invokeIpc('updater:check');
    } catch {
      setCheckingUpdate(false);
      setUpdateStatus({ status: 'error', error: 'Falha ao verificar' });
    }
  }, []);

  const handleInstallUpdate = useCallback(async () => {
    try {
      await invokeIpc('updater:install');
    } catch {
      // ignore
    }
  }, []);

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

  return (
    <div className="h-full flex flex-col">
      {/* Header */}
      <div className="flex items-center gap-3 px-5 py-4 border-b border-slate-800">
        <button
          onClick={onBack}
          className="h-8 w-8 flex items-center justify-center rounded-lg hover:bg-slate-800 text-slate-400 transition-colors"
        >
          <ArrowLeft className="h-4 w-4" />
        </button>
        <h2 className="text-lg font-bold text-slate-100">Configurações</h2>
      </div>

      {/* Content */}
      <div className="flex-1 overflow-y-auto px-5 py-4 space-y-4">
        {/* Startup Section */}
        <div className="space-y-2">
          <h3 className="text-xs font-semibold text-slate-500 uppercase tracking-wider px-1">
            Inicialização
          </h3>
          <div className="space-y-2">
            <Toggle
              enabled={autoLaunch}
              onChange={handleToggleAutoLaunch}
              label="Iniciar com o computador"
              description="Abrir automaticamente ao ligar o computador"
              disabled={loadingSettings}
            />
            <Toggle
              enabled={minimizeToTray}
              onChange={handleToggleMinimize}
              label="Minimizar para a bandeja"
              description="Manter em execução ao fechar a janela"
              disabled={loadingSettings}
            />
          </div>
        </div>

        {/* Updates Section */}
        <div className="space-y-2">
          <h3 className="text-xs font-semibold text-slate-500 uppercase tracking-wider px-1">
            Atualizações
          </h3>
          <div className="bg-slate-800/60 rounded-xl border border-slate-700/50 p-4">
            <div className="flex items-center justify-between mb-3">
              <div>
                <p className="text-sm font-medium text-slate-200">Versão {version}</p>
                <p className="text-xs text-slate-500 mt-0.5">
                  {updateStatus.status === 'not-available' && 'Você está na versão mais recente'}
                  {updateStatus.status === 'checking' && 'Verificando...'}
                  {updateStatus.status === 'available' && `Versão ${updateStatus.version} disponível`}
                  {updateStatus.status === 'downloading' && `Baixando... ${Math.round(updateStatus.progress ?? 0)}%`}
                  {updateStatus.status === 'downloaded' && 'Atualização pronta para instalar'}
                  {updateStatus.status === 'error' && (updateStatus.error || 'Erro ao verificar')}
                </p>
              </div>
            </div>
            {updateStatus.status === 'downloaded' ? (
              <button
                onClick={handleInstallUpdate}
                className="w-full h-9 bg-emerald-600 hover:bg-emerald-700 text-white text-xs font-semibold rounded-lg flex items-center justify-center gap-1.5 transition-colors"
              >
                <Download className="h-3.5 w-3.5" />
                Instalar e Reiniciar
              </button>
            ) : (
              <button
                onClick={handleCheckUpdate}
                disabled={checkingUpdate}
                className="
                  w-full h-9 text-xs font-medium text-slate-300
                  bg-slate-700/50 border border-slate-600/50 rounded-lg
                  hover:bg-slate-700 hover:border-slate-600
                  disabled:opacity-50 disabled:pointer-events-none
                  flex items-center justify-center gap-1.5 transition-colors
                "
              >
                <RefreshCw className={cn('h-3.5 w-3.5', checkingUpdate && 'animate-spin')} />
                {checkingUpdate ? 'Verificando...' : 'Verificar Atualizações'}
              </button>
            )}
          </div>
        </div>

        {/* Unpair Section */}
        <div className="space-y-2">
          <h3 className="text-xs font-semibold text-slate-500 uppercase tracking-wider px-1">
            Vinculação
          </h3>
          <div className="bg-slate-800/60 rounded-xl border border-slate-700/50 p-4">
            <p className="text-xs text-slate-500 mb-3">
              Desvincular este computador do servidor OpenSea. Será necessário parear novamente para enviar impressões.
            </p>
            <button
              onClick={handleUnpair}
              className={cn(
                'w-full h-9 flex items-center justify-center gap-1.5',
                'text-xs font-medium rounded-lg border transition-all duration-200',
                unpairConfirm
                  ? 'bg-rose-500/10 border-rose-500/20 text-rose-400 hover:bg-rose-500/20'
                  : 'bg-slate-700/50 border-slate-600/50 text-slate-300 hover:bg-slate-700 hover:border-slate-600',
              )}
            >
              <Unlink className="h-3.5 w-3.5" />
              {unpairConfirm ? 'Confirmar Desvinculação?' : 'Desvincular'}
            </button>
          </div>
        </div>

        {/* About */}
        <div className="space-y-2">
          <h3 className="text-xs font-semibold text-slate-500 uppercase tracking-wider px-1">
            Sobre
          </h3>
          <div className="bg-slate-800/60 rounded-xl border border-slate-700/50 p-4">
            <div className="flex items-center gap-3">
              <div className="h-10 w-10 rounded-xl bg-gradient-to-br from-blue-500 to-indigo-600 flex items-center justify-center">
                <Printer className="h-5 w-5 text-white" strokeWidth={2} />
              </div>
              <div>
                <p className="text-sm font-semibold text-slate-200">OpenSea Print Server</p>
                <p className="text-xs text-slate-500">Versão {version}</p>
              </div>
            </div>
            <p className="text-xs text-slate-600 mt-3">
              © 2026 OpenSea ERP. Todos os direitos reservados.
            </p>
          </div>
        </div>
      </div>
    </div>
  );
}
