import { Printer, Waves } from 'lucide-react';

interface EmptyStateProps {
  onStartPairing: () => void;
}

export function EmptyState({ onStartPairing }: EmptyStateProps) {
  const version = window.electronAPI?.getVersion?.() ?? '1.0.0';

  return (
    <div className="h-full flex flex-col items-center justify-center px-8 text-center">
      {/* Logo / Icon */}
      <div className="relative mb-8">
        <div className="h-20 w-20 rounded-2xl bg-gradient-to-br from-blue-500 to-indigo-600 flex items-center justify-center shadow-lg shadow-blue-500/20">
          <Waves className="h-10 w-10 text-white" strokeWidth={1.8} />
        </div>
        <div className="absolute -bottom-1 -right-1 h-8 w-8 rounded-lg bg-white border border-gray-200 flex items-center justify-center shadow-sm">
          <Printer className="h-4 w-4 text-gray-600" />
        </div>
      </div>

      {/* Heading */}
      <h1 className="text-xl font-bold text-gray-900 mb-2">
        Bem-vindo ao OpenSea Print Server
      </h1>

      {/* Description */}
      <p className="text-sm text-gray-500 leading-relaxed max-w-xs mb-10">
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
          focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-500 focus-visible:ring-offset-2
        "
      >
        Vincular Computador
      </button>

      {/* Version */}
      <span className="absolute bottom-5 text-xs text-gray-400">
        v{version}
      </span>
    </div>
  );
}
