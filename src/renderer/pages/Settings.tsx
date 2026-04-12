import { useState, useEffect, useCallback } from 'react';
import { ArrowLeft, Download, Info, RefreshCw } from 'lucide-react';
import { Toggle } from '../components/Toggle';
import { invokeIpc } from '../hooks/useIpc';
import type { AppSettings, UpdateStatus } from '../preload';

interface SettingsProps {
  onBack: () => void;
}

export function Settings({ onBack }: SettingsProps) {
  const [settings, setSettings] = useState<AppSettings>({
    autoLaunch: false,
    minimizeToTray: true,
  });
  const [loadingSettings, setLoadingSettings] = useState(true);
  const [updateStatus, setUpdateStatus] = useState<UpdateStatus>({
    status: 'not-available',
  });
  const [checkingUpdate, setCheckingUpdate] = useState(false);

  const version = window.electronAPI?.getVersion?.() ?? '1.0.0';

  // Load settings on mount
  useEffect(() => {
    (async () => {
      try {
        const result = await invokeIpc<AppSettings>('settings:get');
        setSettings(result);
      } catch {
        // Use defaults
      } finally {
        setLoadingSettings(false);
      }
    })();
  }, []);

  const updateSetting = useCallback(
    async <K extends keyof AppSettings>(key: K, value: AppSettings[K]) => {
      const newSettings = { ...settings, [key]: value };
      setSettings(newSettings);
      try {
        await invokeIpc('settings:set', { [key]: value });
      } catch {
        // Revert on failure
        setSettings(settings);
      }
    },
    [settings],
  );

  const handleCheckUpdate = useCallback(async () => {
    setCheckingUpdate(true);
    setUpdateStatus({ status: 'checking' });
    try {
      const result = await invokeIpc<UpdateStatus>('app:check-update');
      setUpdateStatus(result);
    } catch {
      setUpdateStatus({ status: 'error', error: 'Não foi possível verificar atualizações.' });
    } finally {
      setCheckingUpdate(false);
    }
  }, []);

  const handleInstallUpdate = useCallback(async () => {
    try {
      await invokeIpc('app:install-update');
    } catch {
      setUpdateStatus({ status: 'error', error: 'Falha ao instalar atualização.' });
    }
  }, []);

  return (
    <div className="h-full flex flex-col">
      {/* Header */}
      <div className="flex items-center gap-3 px-5 py-4 border-b border-gray-100">
        <button
          onClick={onBack}
          className="
            h-8 w-8 flex items-center justify-center
            rounded-lg hover:bg-gray-100 active:bg-gray-200
            text-gray-600 transition-colors
          "
        >
          <ArrowLeft className="h-4 w-4" />
        </button>
        <h2 className="text-lg font-bold text-gray-900">Configurações</h2>
      </div>

      {/* Content */}
      <div className="flex-1 overflow-y-auto px-5 py-4 space-y-5">
        {/* Startup Section */}
        <section>
          <h3 className="text-xs font-semibold text-gray-400 uppercase tracking-wider mb-3">
            Inicialização
          </h3>
          <div className="bg-white rounded-xl border border-gray-200 shadow-sm divide-y divide-gray-100">
            <div className="px-4 py-3">
              <Toggle
                checked={settings.autoLaunch}
                onChange={(v) => updateSetting('autoLaunch', v)}
                disabled={loadingSettings}
                label="Iniciar com o computador"
                description="Executar automaticamente ao ligar o sistema"
              />
            </div>
            <div className="px-4 py-3">
              <Toggle
                checked={settings.minimizeToTray}
                onChange={(v) => updateSetting('minimizeToTray', v)}
                disabled={loadingSettings}
                label="Minimizar para bandeja ao fechar"
                description="O aplicativo continua rodando em segundo plano"
              />
            </div>
          </div>
        </section>

        {/* Updates Section */}
        <section>
          <h3 className="text-xs font-semibold text-gray-400 uppercase tracking-wider mb-3">
            Atualizações
          </h3>
          <div className="bg-white rounded-xl border border-gray-200 shadow-sm p-4">
            <div className="flex items-center justify-between mb-3">
              <div>
                <span className="text-sm font-medium text-gray-900">
                  Versão atual: {version}
                </span>
              </div>
              <button
                onClick={handleCheckUpdate}
                disabled={checkingUpdate}
                className="
                  h-8 px-3 flex items-center gap-1.5
                  text-xs font-medium text-gray-600
                  bg-gray-50 border border-gray-200 rounded-lg
                  hover:bg-gray-100 active:bg-gray-200
                  disabled:opacity-50 disabled:pointer-events-none
                  transition-colors
                "
              >
                <RefreshCw className={`h-3 w-3 ${checkingUpdate ? 'animate-spin' : ''}`} />
                Verificar
              </button>
            </div>

            {/* Update Status Display */}
            {updateStatus.status === 'checking' && (
              <div className="flex items-center gap-2 text-xs text-gray-500">
                <div className="h-3 w-3 rounded-full border border-gray-300 border-t-blue-600 animate-spin" />
                Verificando atualizações...
              </div>
            )}

            {updateStatus.status === 'available' && (
              <div className="flex items-center justify-between bg-blue-50 rounded-lg px-3 py-2">
                <div className="flex items-center gap-2">
                  <Download className="h-4 w-4 text-blue-600" />
                  <span className="text-xs font-medium text-blue-700">
                    Versão {updateStatus.version} disponível
                  </span>
                </div>
                <button
                  onClick={handleInstallUpdate}
                  className="
                    h-7 px-3 text-xs font-semibold
                    bg-blue-600 hover:bg-blue-700
                    text-white rounded-md
                    transition-colors
                  "
                >
                  Instalar
                </button>
              </div>
            )}

            {updateStatus.status === 'not-available' && !checkingUpdate && (
              <div className="flex items-center gap-2 text-xs text-gray-500">
                <Info className="h-3 w-3" />
                Você está na versão mais recente.
              </div>
            )}

            {updateStatus.status === 'downloading' && (
              <div className="space-y-1.5">
                <div className="flex items-center gap-2 text-xs text-blue-600">
                  <Download className="h-3 w-3" />
                  Baixando atualização...
                </div>
                {typeof updateStatus.progress === 'number' && (
                  <div className="h-1.5 bg-gray-100 rounded-full overflow-hidden">
                    <div
                      className="h-full bg-blue-600 rounded-full transition-all duration-300"
                      style={{ width: `${updateStatus.progress}%` }}
                    />
                  </div>
                )}
              </div>
            )}

            {updateStatus.status === 'downloaded' && (
              <div className="flex items-center justify-between bg-emerald-50 rounded-lg px-3 py-2">
                <span className="text-xs font-medium text-emerald-700">
                  Atualização pronta para instalar
                </span>
                <button
                  onClick={handleInstallUpdate}
                  className="
                    h-7 px-3 text-xs font-semibold
                    bg-emerald-600 hover:bg-emerald-700
                    text-white rounded-md
                    transition-colors
                  "
                >
                  Reiniciar e instalar
                </button>
              </div>
            )}

            {updateStatus.status === 'error' && (
              <div className="flex items-center gap-2 text-xs text-rose-600">
                <Info className="h-3 w-3" />
                {updateStatus.error}
              </div>
            )}
          </div>
        </section>

        {/* About Section */}
        <section>
          <h3 className="text-xs font-semibold text-gray-400 uppercase tracking-wider mb-3">
            Sobre
          </h3>
          <div className="bg-white rounded-xl border border-gray-200 shadow-sm p-4 space-y-2">
            <div className="flex items-center justify-between text-sm">
              <span className="text-gray-500">Aplicativo</span>
              <span className="font-medium text-gray-900">OpenSea Print Server</span>
            </div>
            <div className="flex items-center justify-between text-sm">
              <span className="text-gray-500">Versão</span>
              <span className="font-medium text-gray-900">{version}</span>
            </div>
            <div className="border-t border-gray-100 pt-2 mt-2">
              <p className="text-xs text-gray-400 text-center">
                &copy; {new Date().getFullYear()} OpenSea ERP. Todos os direitos reservados.
              </p>
            </div>
          </div>
        </section>
      </div>
    </div>
  );
}
