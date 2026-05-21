import { AppWindow, useTheme } from '@opensea/satellite-ui';
import { Printer } from 'lucide-react';
import { useCallback, useEffect, useState } from 'react';
import { UpdateModal } from './components/UpdateModal';
import { invokeIpc, useIpcEvent } from './hooks/useIpc';
import { Dashboard } from './pages/Dashboard';
import { EmptyState } from './pages/EmptyState';
import { PairingFlow } from './pages/PairingFlow';
import { Settings } from './pages/Settings';
import type { AgentStatus, UpdateStatus } from './preload';

type AppView = 'loading' | 'empty' | 'pairing' | 'dashboard' | 'settings';

export function App() {
  const [view, setView] = useState<AppView>('loading');
  const [status, setStatus] = useState<AgentStatus | null>(null);
  const [updateModal, setUpdateModal] = useState<UpdateStatus | null>(null);
  const [manualUpdateCheck, setManualUpdateCheck] = useState(false);

  // Sync data-sat-{theme,density} no documentElement para que os tokens CSS
  // do satellite-ui cascateiem. Lê do ThemeProvider (main.tsx) — single source of truth.
  const { colorMode, density } = useTheme();
  useEffect(() => {
    document.documentElement.setAttribute('data-sat-theme', colorMode);
    document.documentElement.setAttribute('data-sat-density', density);
  }, [colorMode, density]);

  useIpcEvent(
    'updater:manual-check',
    useCallback(() => {
      setManualUpdateCheck(true);
    }, []),
  );

  useIpcEvent<UpdateStatus>(
    'updater:status',
    useCallback(
      (data: UpdateStatus) => {
        const mapped = data.status === 'up-to-date' ? 'not-available' : data.status;
        // `error` precisa estar no alwaysShow para destravar o modal quando o
        // download fail após `manualUpdateCheck` já ter virado false (cenário
        // típico: assinatura Authenticode falha em build unsigned, modal fica
        // preso em "100% concluído" sem nunca mostrar a falha real).
        const alwaysShow = ['available', 'downloading', 'downloaded', 'error'].includes(mapped);
        if (alwaysShow || manualUpdateCheck) {
          setUpdateModal({ ...data, status: mapped as UpdateStatus['status'] });
          if (mapped !== 'checking' && mapped !== 'downloading') {
            setManualUpdateCheck(false);
          }
        }
      },
      [manualUpdateCheck],
    ),
  );

  useIpcEvent<string>(
    'connection:status',
    useCallback((connStatus: string) => {
      setStatus((prev) => (prev ? { ...prev, connected: connStatus === 'connected' } : prev));
    }, []),
  );

  // Satellite Contract v1: backend told us the pairing was killed
  // (admin clicked "Unpair", security force-revoked, etc). The socket
  // is about to close with 4003 — we proactively (a) clear the local
  // device token + agent metadata via `agent:unpair` so the next
  // launch starts clean, and (b) flip back to the empty/pair view so
  // the user does not stare at a stale dashboard while reconnect
  // attempts loop in the background.
  useIpcEvent<{ reason: string }>(
    'device:revoked',
    useCallback(() => {
      invokeIpc('agent:unpair').catch(() => {
        // best-effort — even if cleanup IPC fails the WS reconnect
        // will be rejected with 4003 and the user will land on the
        // pair page on next start.
      });
      setStatus(null);
      setView('empty');
    }, []),
  );

  const checkStatus = useCallback(async () => {
    try {
      const result = await invokeIpc<AgentStatus>('agent:get-status');
      setStatus(result);
      setView(result.paired ? 'dashboard' : 'empty');
    } catch {
      setStatus({
        paired: false,
        connected: false,
        computerName: '',
        ipAddress: '',
      });
      setView('empty');
    }
  }, []);

  useEffect(() => {
    checkStatus();
  }, [checkStatus]);

  const handlePairingSuccess = useCallback(async () => {
    await checkStatus();
  }, [checkStatus]);

  const handleUnpair = useCallback(() => {
    setStatus(null);
    setView('empty');
  }, []);

  return (
    <AppWindow title="PrintServer" windowApi={window.windowApi}>
      <div className="h-full flex flex-col bg-slate-900 overflow-hidden relative">
        {updateModal && (
          <UpdateModal
            status={updateModal}
            onClose={() => setUpdateModal(null)}
            onInstall={async () => {
              try {
                await invokeIpc('updater:install');
              } catch {}
            }}
          />
        )}
        <div className="flex-1 overflow-hidden">
          {view === 'loading' && <LoadingScreen />}
          {view === 'empty' && <EmptyState onStartPairing={() => setView('pairing')} />}
          {view === 'pairing' && (
            <PairingFlow onBack={() => setView('empty')} onSuccess={handlePairingSuccess} />
          )}
          {view === 'dashboard' && status && (
            <Dashboard
              status={status}
              onRefreshStatus={checkStatus}
              onOpenSettings={() => setView('settings')}
            />
          )}
          {view === 'settings' && (
            <Settings onBack={() => setView('dashboard')} onUnpair={handleUnpair} />
          )}
        </div>
      </div>
    </AppWindow>
  );
}

function LoadingScreen() {
  return (
    <div className="h-full flex flex-col items-center justify-center gap-6">
      <div className="relative">
        <div className="h-20 w-20 rounded-2xl bg-gradient-to-br from-blue-500 to-indigo-600 flex items-center justify-center shadow-lg shadow-blue-500/20 animate-pulse">
          <Printer className="h-10 w-10 text-white" strokeWidth={1.8} />
        </div>
        <div className="absolute -inset-3 animate-spin" style={{ animationDuration: '3s' }}>
          <div className="h-2.5 w-2.5 rounded-full bg-blue-400 shadow-lg shadow-blue-400/50" />
        </div>
      </div>

      <div className="text-center">
        <h1 className="text-lg font-bold text-slate-100 mb-1">OpenSea Print Server</h1>
        <p className="text-sm text-slate-500">Iniciando...</p>
      </div>

      <div className="w-32 h-1 rounded-full bg-slate-800 overflow-hidden">
        <div className="h-full w-1/2 rounded-full bg-gradient-to-r from-blue-500 to-indigo-500 animate-loading-bar" />
      </div>
    </div>
  );
}
