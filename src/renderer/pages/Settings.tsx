import { AlertTriangle, ArrowLeft, Download, Printer, RefreshCw, Unlink } from 'lucide-react';
import { useCallback, useEffect, useState } from 'react';
import { Toggle } from '../components/Toggle';
import { invokeIpc, useIpcEvent } from '../hooks/useIpc';
import type { UpdateStatus } from '../preload';
import { cn } from '../utils';

interface SettingsProps {
  onBack: () => void;
  onUnpair: () => void;
}

export function Settings({ onBack, onUnpair }: SettingsProps) {
  const [autoLaunch, setAutoLaunch] = useState(false);
  const [minimizeToTray, setMinimizeToTray] = useState(true);
  const [loadingSettings, setLoadingSettings] = useState(true);
  const [updateStatus, setUpdateStatus] = useState<UpdateStatus>({
    status: 'not-available',
  });
  const [checkingUpdate, setCheckingUpdate] = useState(false);
  const [version, setVersion] = useState('1.0.0');
  const [showUnpairModal, setShowUnpairModal] = useState(false);

  useEffect(() => {
    invokeIpc<string>('app:get-version')
      .then((v) => setVersion(v))
      .catch(() => {});
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
    // Optimistic UI for snappy feedback, but reconcile against the actual
    // result returned by the IPC handler. In dev (devGuard no-op) or if the
    // OS rejects the change, the runtime returns the unchanged state and
    // we revert. (Codex review fix 2026-05-03.)
    setAutoLaunch(val);
    try {
      const result = await invokeIpc<{ success: boolean; enabled?: boolean }>('auto-launch:toggle');
      if (!result?.success) {
        setAutoLaunch(!val);
        return;
      }
      if (typeof result.enabled === 'boolean') {
        setAutoLaunch(result.enabled);
      }
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

  useIpcEvent<UpdateStatus>(
    'updater:status',
    useCallback((data: UpdateStatus) => {
      const mapped = data.status === 'up-to-date' ? 'not-available' : data.status;
      setUpdateStatus({ ...data, status: mapped as UpdateStatus['status'] });
      if (mapped !== 'checking' && mapped !== 'downloading') {
        setCheckingUpdate(false);
      }
    }, []),
  );

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

  const handleConfirmUnpair = useCallback(async () => {
    try {
      await invokeIpc('agent:unpair');
      setShowUnpairModal(false);
      onUnpair();
    } catch {
      // ignore
    }
  }, [onUnpair]);

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
        {/* About (first) */}
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
                  {updateStatus.status === 'available' &&
                    `Versão ${updateStatus.version} disponível`}
                  {updateStatus.status === 'downloading' &&
                    `Baixando... ${Math.round(updateStatus.progress ?? 0)}%`}
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

        {/* Unpair Section (last) */}
        <div className="space-y-2">
          <h3 className="text-xs font-semibold text-rose-400/60 uppercase tracking-wider px-1">
            Zona de perigo
          </h3>
          <div className="bg-slate-800/60 rounded-xl border border-rose-500/20 p-4">
            <p className="text-xs text-slate-500 mb-3">
              Desvincular este computador do servidor OpenSea. Será necessário parear novamente para
              enviar impressões.
            </p>
            <button
              onClick={() => setShowUnpairModal(true)}
              className="
                w-full h-9 flex items-center justify-center gap-1.5
                text-xs font-medium rounded-lg border transition-colors
                bg-rose-500/10 border-rose-500/20 text-rose-400 hover:bg-rose-500/20
              "
            >
              <Unlink className="h-3.5 w-3.5" />
              Desvincular
            </button>
          </div>
        </div>
      </div>

      {/* ── Unpair Confirmation Modal ─────────────────────────────────── */}
      {showUnpairModal && (
        <>
          <div
            className="fixed inset-0 bg-black/50 z-40"
            onClick={() => setShowUnpairModal(false)}
          />
          <div className="fixed inset-0 z-50 flex items-center justify-center p-6">
            <div className="bg-slate-900 border border-slate-700/50 rounded-2xl shadow-2xl w-full max-w-sm p-6">
              {/* Icon */}
              <div className="flex justify-center mb-4">
                <div className="h-12 w-12 rounded-full bg-rose-500/10 border border-rose-500/20 flex items-center justify-center">
                  <AlertTriangle className="h-6 w-6 text-rose-400" />
                </div>
              </div>

              {/* Title */}
              <h3 className="text-base font-bold text-slate-100 text-center mb-2">
                Desvincular computador?
              </h3>

              {/* Description */}
              <p className="text-xs text-slate-400 text-center leading-relaxed mb-6">
                Este computador será desconectado do servidor OpenSea e não receberá mais comandos
                de impressão. Você precisará parear novamente com um novo código.
              </p>

              {/* Buttons */}
              <div className="flex gap-3">
                <button
                  onClick={() => setShowUnpairModal(false)}
                  className="
                    flex-1 h-9 text-xs font-medium text-slate-300
                    bg-slate-800 border border-slate-700 rounded-lg
                    hover:bg-slate-700 transition-colors
                  "
                >
                  Cancelar
                </button>
                <button
                  onClick={handleConfirmUnpair}
                  className="
                    flex-1 h-9 text-xs font-semibold text-white
                    bg-rose-600 hover:bg-rose-700 rounded-lg
                    transition-colors
                  "
                >
                  Desvincular
                </button>
              </div>
            </div>
          </div>
        </>
      )}
    </div>
  );
}
