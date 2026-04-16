import { useState, useEffect, useCallback } from 'react';
import { EmptyState } from './pages/EmptyState';
import { PairingFlow } from './pages/PairingFlow';
import { Dashboard } from './pages/Dashboard';
import { Settings } from './pages/Settings';
import { UpdateModal } from './components/UpdateModal';
import { invokeIpc, useIpcEvent } from './hooks/useIpc';
import type { AgentStatus, UpdateStatus } from './preload';
import { Printer } from 'lucide-react';

type AppView = 'loading' | 'empty' | 'pairing' | 'dashboard' | 'settings';

export function App() {
  const [view, setView] = useState<AppView>('loading');
  const [status, setStatus] = useState<AgentStatus | null>(null);
  const [updateModal, setUpdateModal] = useState<UpdateStatus | null>(null);
  const [manualUpdateCheck, setManualUpdateCheck] = useState(false);

  useIpcEvent('updater:manual-check', useCallback(() => {
    setManualUpdateCheck(true);
  }, []));

  useIpcEvent<UpdateStatus>('updater:status', useCallback((data: UpdateStatus) => {
    const mapped = data.status === 'up-to-date' ? 'not-available' : data.status;
    const alwaysShow = ['available', 'downloading', 'downloaded'].includes(mapped);
    if (alwaysShow || manualUpdateCheck) {
      setUpdateModal({ ...data, status: mapped as UpdateStatus['status'] });
      if (mapped !== 'checking' && mapped !== 'downloading') {
        setManualUpdateCheck(false);
      }
    }
  }, [manualUpdateCheck]));

  useIpcEvent<string>('connection:status', useCallback((connStatus: string) => {
    setStatus((prev) => prev ? { ...prev, connected: connStatus === 'connected' } : prev);
  }, []));

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
    <div className="h-full flex flex-col bg-slate-900 overflow-hidden relative">
      {updateModal && (
        <UpdateModal
          status={updateModal}
          onClose={() => setUpdateModal(null)}
          onInstall={async () => {
            try { await invokeIpc('updater:install'); } catch {}
          }}
        />
      )}
      <div className="flex-1 overflow-hidden">
        {view === 'loading' && <LoadingScreen />}
        {view === 'empty' && (
          <EmptyState onStartPairing={() => setView('pairing')} />
        )}
        {view === 'pairing' && (
          <PairingFlow
            onBack={() => setView('empty')}
            onSuccess={handlePairingSuccess}
          />
        )}
        {view === 'dashboard' && status && (
          <Dashboard
            status={status}
            onRefreshStatus={checkStatus}
            onOpenSettings={() => setView('settings')}
          />
        )}
        {view === 'settings' && (
          <Settings
            onBack={() => setView('dashboard')}
            onUnpair={handleUnpair}
          />
        )}
      </div>
    </div>
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
        <h1 className="text-lg font-bold text-slate-100 mb-1">
          OpenSea Print Server
        </h1>
        <p className="text-sm text-slate-500">Iniciando...</p>
      </div>

      <div className="w-32 h-1 rounded-full bg-slate-800 overflow-hidden">
        <div className="h-full w-1/2 rounded-full bg-gradient-to-r from-blue-500 to-indigo-500 animate-loading-bar" />
      </div>
    </div>
  );
}
