import { useState, useEffect } from 'react';
import { Printer, Waves, ArrowRight } from 'lucide-react';
import { invokeIpc } from '../hooks/useIpc';

interface EmptyStateProps {
  onStartPairing: () => void;
}

export function EmptyState({ onStartPairing }: EmptyStateProps) {
  const [version, setVersion] = useState('1.0.0');

  useEffect(() => {
    invokeIpc<string>('app:get-version')
      .then((v) => setVersion(v))
      .catch(() => {});
  }, []);

  return (
    <div className="h-full flex flex-col items-center justify-center px-8 text-center relative">
      {/* Background decorations */}
      <div className="absolute top-0 right-0 w-64 h-64 bg-blue-500/5 rounded-full -translate-y-1/2 translate-x-1/2" />
      <div className="absolute bottom-0 left-0 w-48 h-48 bg-indigo-500/5 rounded-full translate-y-1/2 -translate-x-1/2" />

      <div className="relative z-10 flex flex-col items-center">
        {/* Logo */}
        <div className="relative mb-8">
          <div className="h-20 w-20 rounded-2xl bg-gradient-to-br from-blue-500 to-indigo-600 flex items-center justify-center shadow-lg shadow-blue-500/20">
            <Waves className="h-10 w-10 text-white" strokeWidth={1.8} />
          </div>
          <div className="absolute -bottom-1 -right-1 h-8 w-8 rounded-lg bg-slate-800 border border-slate-700 flex items-center justify-center shadow-sm">
            <Printer className="h-4 w-4 text-slate-400" />
          </div>
        </div>

        {/* Heading */}
        <h1 className="text-xl font-bold text-slate-100 mb-2">
          Bem-vindo ao Print Server
        </h1>

        {/* Description */}
        <p className="text-sm text-slate-400 leading-relaxed max-w-xs mb-10">
          Conecte este computador ao OpenSea para gerenciar e executar
          impressões remotamente.
        </p>

        {/* CTA Button */}
        <button
          onClick={onStartPairing}
          className="
            w-full max-w-xs h-11 px-6
            bg-blue-600 hover:bg-blue-700 active:bg-blue-800
            text-white text-sm font-semibold
            rounded-xl shadow-sm shadow-blue-600/20
            transition-all duration-150
            focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-500 focus-visible:ring-offset-2 focus-visible:ring-offset-slate-900
            flex items-center justify-center gap-2
          "
        >
          Vincular Computador
          <ArrowRight className="h-4 w-4" />
        </button>
      </div>

      {/* Version */}
      <span className="absolute bottom-5 text-xs text-slate-600">
        v{version}
      </span>
    </div>
  );
}
