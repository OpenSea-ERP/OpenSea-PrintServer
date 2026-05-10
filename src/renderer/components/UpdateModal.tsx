import { AlertCircle, CheckCircle2, Download, Loader2, Waves, X } from 'lucide-react';
import type { UpdateStatus } from '../preload';
import { cn } from '../utils';

interface UpdateModalProps {
  status: UpdateStatus;
  onClose: () => void;
  onInstall: () => void;
}

export function UpdateModal({ status, onClose, onInstall }: UpdateModalProps) {
  const canClose = status.status !== 'downloading';

  return (
    <div className="absolute inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm">
      <div className="bg-slate-800 border border-slate-700/50 rounded-2xl shadow-2xl w-80 overflow-hidden">
        {/* Header */}
        <div className="flex items-center justify-between px-5 pt-5 pb-3">
          <div className="flex items-center gap-2">
            <div className="h-7 w-7 rounded-lg bg-gradient-to-br from-blue-500 to-indigo-600 flex items-center justify-center">
              <Waves className="h-3.5 w-3.5 text-white" strokeWidth={2} />
            </div>
            <h3 className="text-sm font-bold text-slate-100">Atualizações</h3>
          </div>
          {canClose && (
            <button
              onClick={onClose}
              className="h-7 w-7 flex items-center justify-center rounded-lg hover:bg-slate-700 text-slate-400 transition-colors"
            >
              <X className="h-4 w-4" />
            </button>
          )}
        </div>

        {/* Content */}
        <div className="px-5 pb-5">
          {/* Checking */}
          {status.status === 'checking' && (
            <div className="flex flex-col items-center py-6 gap-3">
              <Loader2 className="h-8 w-8 text-blue-400 animate-spin" />
              <p className="text-sm text-slate-300">Verificando atualizações...</p>
            </div>
          )}

          {/* Up to date */}
          {status.status === 'not-available' && (
            <div className="flex flex-col items-center py-6 gap-3">
              <div className="h-12 w-12 rounded-full bg-emerald-500/10 border border-emerald-500/20 flex items-center justify-center">
                <CheckCircle2 className="h-6 w-6 text-emerald-400" />
              </div>
              <div className="text-center">
                <p className="text-sm font-semibold text-slate-100">Tudo atualizado</p>
                <p className="text-xs text-slate-500 mt-1">Você está na versão mais recente.</p>
              </div>
            </div>
          )}

          {/* Available */}
          {status.status === 'available' && (
            <div className="flex flex-col items-center py-6 gap-4">
              <div className="h-12 w-12 rounded-full bg-blue-500/10 border border-blue-500/20 flex items-center justify-center">
                <Download className="h-6 w-6 text-blue-400" />
              </div>
              <div className="text-center">
                <p className="text-sm font-semibold text-slate-100">Nova versão disponível</p>
                <p className="text-xs text-slate-500 mt-1">
                  Versão {status.version} está pronta para download.
                </p>
              </div>
              <p className="text-xs text-slate-500">O download iniciará automaticamente.</p>
            </div>
          )}

          {/* Downloading */}
          {status.status === 'downloading' && (
            <div className="flex flex-col items-center py-6 gap-4">
              <div className="h-12 w-12 rounded-full bg-blue-500/10 border border-blue-500/20 flex items-center justify-center">
                <Download className="h-6 w-6 text-blue-400 animate-bounce" />
              </div>
              <div className="text-center">
                <p className="text-sm font-semibold text-slate-100">Baixando atualização...</p>
                <p className="text-xs text-slate-500 mt-1">
                  {Math.round(status.progress ?? 0)}% concluído
                </p>
              </div>
              <div className="w-full h-2 rounded-full bg-slate-700 overflow-hidden">
                <div
                  className="h-full rounded-full bg-gradient-to-r from-blue-500 to-indigo-500 transition-all duration-300"
                  style={{ width: `${status.progress ?? 0}%` }}
                />
              </div>
            </div>
          )}

          {/* Downloaded */}
          {status.status === 'downloaded' && (
            <div className="flex flex-col items-center py-6 gap-4">
              <div className="h-12 w-12 rounded-full bg-emerald-500/10 border border-emerald-500/20 flex items-center justify-center">
                <CheckCircle2 className="h-6 w-6 text-emerald-400" />
              </div>
              <div className="text-center">
                <p className="text-sm font-semibold text-slate-100">Atualização pronta</p>
                <p className="text-xs text-slate-500 mt-1">
                  Versão {status.version} foi baixada. Reinicie para aplicar.
                </p>
              </div>
              <div className="flex gap-2 w-full">
                <button
                  onClick={onClose}
                  className="flex-1 h-9 text-xs font-medium text-slate-300 bg-slate-700/50 border border-slate-600/50 rounded-lg hover:bg-slate-700 transition-colors"
                >
                  Mais tarde
                </button>
                <button
                  onClick={onInstall}
                  className="flex-1 h-9 text-xs font-semibold text-white bg-emerald-600 hover:bg-emerald-700 rounded-lg flex items-center justify-center gap-1.5 transition-colors"
                >
                  <Download className="h-3.5 w-3.5" />
                  Reiniciar agora
                </button>
              </div>
            </div>
          )}

          {/* Error */}
          {status.status === 'error' && (
            <div className="flex flex-col items-center py-6 gap-3">
              <div className="h-12 w-12 rounded-full bg-rose-500/10 border border-rose-500/20 flex items-center justify-center">
                <AlertCircle className="h-6 w-6 text-rose-400" />
              </div>
              <div className="text-center">
                <p className="text-sm font-semibold text-slate-100">Erro na verificação</p>
                <p className="text-xs text-slate-500 mt-1">
                  {status.error || 'Não foi possível verificar atualizações.'}
                </p>
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
