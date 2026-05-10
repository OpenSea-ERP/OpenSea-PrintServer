import { AlertCircle, ArrowLeft, CheckCircle2, Loader2, QrCode } from 'lucide-react';
import { useCallback, useEffect, useRef, useState } from 'react';
import { invokeIpc } from '../hooks/useIpc';
import type { PairingResult } from '../preload';
import { cn } from '../utils';

interface PairingFlowProps {
  onBack: () => void;
  onSuccess: () => void;
}

type PairingState = 'input' | 'loading' | 'success' | 'error';

// Stable keys for the 6 fixed TOTP digit slots — positions never reorder.
const DIGIT_SLOT_KEYS = ['slot-1', 'slot-2', 'slot-3', 'slot-4', 'slot-5', 'slot-6'] as const;

export function PairingFlow({ onBack, onSuccess }: PairingFlowProps) {
  const [digits, setDigits] = useState<string[]>(['', '', '', '', '', '']);
  const [state, setState] = useState<PairingState>('input');
  const [errorMessage, setErrorMessage] = useState('');
  const inputRefs = useRef<(HTMLInputElement | null)[]>([]);

  useEffect(() => {
    inputRefs.current[0]?.focus();
  }, []);

  const code = digits.join('');
  const isComplete = code.length === 6 && digits.every((d) => d !== '');

  const handleInput = useCallback((index: number, value: string) => {
    const char = value
      .replace(/[^a-zA-Z0-9]/g, '')
      .slice(-1)
      .toUpperCase();
    setDigits((prev) => {
      const next = [...prev];
      next[index] = char;
      return next;
    });
    if (char && index < 5) {
      inputRefs.current[index + 1]?.focus();
    }
  }, []);

  const handleKeyDown = useCallback(
    (index: number, e: React.KeyboardEvent<HTMLInputElement>) => {
      if (e.key === 'Backspace' && !digits[index] && index > 0) {
        inputRefs.current[index - 1]?.focus();
        setDigits((prev) => {
          const next = [...prev];
          next[index - 1] = '';
          return next;
        });
      }
    },
    [digits],
  );

  const handlePaste = useCallback((e: React.ClipboardEvent) => {
    e.preventDefault();
    const pasted = e.clipboardData
      .getData('text')
      .replace(/[^a-zA-Z0-9]/g, '')
      .toUpperCase()
      .slice(0, 6);
    if (!pasted) return;
    const newDigits = [...Array(6)].map((_, i) => pasted[i] || '');
    setDigits(newDigits);
    const focusIndex = Math.min(pasted.length, 5);
    inputRefs.current[focusIndex]?.focus();
  }, []);

  const handleSubmit = useCallback(async () => {
    if (!isComplete) return;
    setState('loading');
    setErrorMessage('');
    try {
      const result = await invokeIpc<PairingResult>('agent:pair', code);
      if (result.success) {
        setState('success');
        setTimeout(() => onSuccess(), 1500);
      } else {
        setState('error');
        setErrorMessage(result.error || 'Falha ao vincular. Verifique o código e tente novamente.');
      }
    } catch (err) {
      setState('error');
      setErrorMessage(err instanceof Error ? err.message : 'Erro de conexão.');
    }
  }, [code, isComplete, onSuccess]);

  const handleRetry = useCallback(() => {
    setDigits(['', '', '', '', '', '']);
    setState('input');
    setErrorMessage('');
    setTimeout(() => inputRefs.current[0]?.focus(), 50);
  }, []);

  return (
    <div className="h-full flex flex-col px-6 py-5">
      {/* Header */}
      <div className="flex items-center gap-3 mb-8">
        <button
          type="button"
          onClick={onBack}
          disabled={state === 'loading'}
          className="
            h-8 w-8 flex items-center justify-center
            rounded-lg hover:bg-slate-800 active:bg-slate-700
            text-slate-400 transition-colors
            disabled:opacity-40 disabled:pointer-events-none
          "
        >
          <ArrowLeft className="h-4 w-4" />
        </button>
        <h2 className="text-lg font-bold text-slate-100">Vincular ao OpenSea</h2>
      </div>

      <div className="flex-1 flex flex-col items-center">
        {(state === 'input' || state === 'loading') && (
          <>
            {/* Icon */}
            <div className="h-14 w-14 rounded-xl bg-violet-500/10 border border-violet-500/20 flex items-center justify-center mb-5">
              <QrCode className="h-7 w-7 text-violet-400" />
            </div>

            <p className="text-sm text-slate-400 text-center leading-relaxed mb-8 max-w-xs">
              Digite o código de pareamento exibido no painel de Impressoras Remotas do OpenSea.
            </p>

            {/* Code Input Boxes */}
            <div className="flex gap-2.5 mb-8" onPaste={handlePaste}>
              {digits.map((digit, i) => (
                <input
                  key={DIGIT_SLOT_KEYS[i]}
                  ref={(el) => {
                    inputRefs.current[i] = el;
                  }}
                  type="text"
                  inputMode="text"
                  maxLength={1}
                  value={digit}
                  disabled={state === 'loading'}
                  onChange={(e) => handleInput(i, e.target.value)}
                  onKeyDown={(e) => handleKeyDown(i, e)}
                  className={cn(
                    'h-14 w-12 text-center text-xl font-bold',
                    'rounded-xl border-2 bg-slate-800/60',
                    'transition-all duration-150',
                    'focus:border-blue-500 focus:ring-4 focus:ring-blue-500/10',
                    'disabled:opacity-50 disabled:cursor-not-allowed',
                    digit ? 'border-slate-600 text-slate-100' : 'border-slate-700 text-slate-500',
                  )}
                />
              ))}
            </div>

            {/* Submit */}
            <button
              type="button"
              onClick={handleSubmit}
              disabled={!isComplete || state === 'loading'}
              className="
                w-full max-w-xs h-11 px-6
                bg-blue-600 hover:bg-blue-700 active:bg-blue-800
                disabled:bg-slate-800 disabled:text-slate-600 disabled:border disabled:border-slate-700
                text-white text-sm font-semibold
                rounded-xl shadow-sm
                transition-all duration-150
                flex items-center justify-center gap-2
              "
            >
              {state === 'loading' ? (
                <>
                  <Loader2 className="h-4 w-4 animate-spin" />
                  Vinculando...
                </>
              ) : (
                'Vincular'
              )}
            </button>
          </>
        )}

        {state === 'success' && (
          <div className="flex-1 flex flex-col items-center justify-center gap-4">
            <div className="h-16 w-16 rounded-full bg-emerald-500/10 border border-emerald-500/20 flex items-center justify-center">
              <CheckCircle2 className="h-8 w-8 text-emerald-400" />
            </div>
            <div className="text-center">
              <h3 className="text-lg font-bold text-slate-100 mb-1">Vinculado com sucesso</h3>
              <p className="text-sm text-slate-400">Seu computador foi conectado ao OpenSea.</p>
            </div>
          </div>
        )}

        {state === 'error' && (
          <div className="flex-1 flex flex-col items-center justify-center gap-4">
            <div className="h-16 w-16 rounded-full bg-rose-500/10 border border-rose-500/20 flex items-center justify-center">
              <AlertCircle className="h-8 w-8 text-rose-400" />
            </div>
            <div className="text-center">
              <h3 className="text-lg font-bold text-slate-100 mb-1">Falha na vinculação</h3>
              <p className="text-sm text-slate-400 max-w-xs">{errorMessage}</p>
            </div>
            <button
              type="button"
              onClick={handleRetry}
              className="
                h-10 px-6
                bg-blue-600 hover:bg-blue-700 active:bg-blue-800
                text-white text-sm font-semibold
                rounded-xl shadow-sm
                transition-all duration-150
              "
            >
              Tentar novamente
            </button>
          </div>
        )}
      </div>
    </div>
  );
}
