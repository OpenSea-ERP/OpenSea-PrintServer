import { useState, useEffect, useCallback } from 'react';
import { EmptyState } from './pages/EmptyState';
import { PairingFlow } from './pages/PairingFlow';
import { Dashboard } from './pages/Dashboard';
import { Settings } from './pages/Settings';
import { invokeIpc } from './hooks/useIpc';
import type { AgentStatus } from './preload';

type AppView = 'loading' | 'empty' | 'pairing' | 'dashboard' | 'settings';

export function App() {
  const [view, setView] = useState<AppView>('loading');
  const [status, setStatus] = useState<AgentStatus | null>(null);

  const checkStatus = useCallback(async () => {
    try {
      const result = await invokeIpc<AgentStatus>('agent:get-status');
      setStatus(result);
      setView(result.paired ? 'dashboard' : 'empty');
    } catch {
      // If IPC fails (dev mode without Electron), show empty state
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
    <div className="h-full flex flex-col bg-gray-50 overflow-hidden">
      <div className="flex-1 overflow-y-auto">
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
            onUnpair={handleUnpair}
          />
        )}

        {view === 'settings' && (
          <Settings onBack={() => setView('dashboard')} />
        )}
      </div>
    </div>
  );
}

function LoadingScreen() {
  return (
    <div className="h-full flex flex-col items-center justify-center gap-3">
      <div className="relative h-10 w-10">
        <div className="absolute inset-0 rounded-full border-2 border-gray-200" />
        <div className="absolute inset-0 rounded-full border-2 border-blue-600 border-t-transparent animate-spin" />
      </div>
      <span className="text-sm text-gray-500">Carregando...</span>
    </div>
  );
}
