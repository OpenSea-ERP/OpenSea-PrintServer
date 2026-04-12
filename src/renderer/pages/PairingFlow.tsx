import { useState, useRef, useCallback, useEffect } from 'react';
import { ArrowLeft, CheckCircle2, AlertCircle, Loader2 } from 'lucide-react';
import { invokeIpc } from '../hooks/useIpc';
import type { PairingResult } from '../preload';

interface PairingFlowProps {
  onBack: () => void;
  onSuccess: () => void;
}

type PairingState = 'input' | 'loading' | 'success' | 'error';

export function PairingFlow({ onBack, onSuccess }: PairingFlowProps) {
  const [digits, setDigits] = useState<string[]>(['', '', '', '', '', '']);
  const [state, setState] = useState<PairingState>('input');
  const [errorMessage, setErrorMessage] = useState('');
  const inputRefs = useRef<(HTMLInputElement | null)[]>([]);

  // Auto-focus first input on mount
  useEffect(() => {
    inputRefs.current[0]?.focus();
  }, []);

  const code = digits.join('');
  const isComplete = code.length === 6 && digits.every((d) => d !== '');

  const handleInput = useCallback(
    (index: number, value: string) => {
      // Only allow digits
      const digit = value.replace(/\D/g, '').slice(-1);

      setDigits((prev) => {
        const next = [...prev];
        next[index] = digit;
        return next;
      });

      // Auto-advance to next input
      if (digit && index < 5) {
        inputRefs.current[index + 1]?.focus();
      }
    },
    [],
  );

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
    const pasted = e.clipboardData.getData('text').replace(/\D/g, '').slice(0, 6);
    if (!pasted) return;

    const newDigits = [...Array(6)].map((_, i) => pasted[i] || '');
    setDigits(newDigits);

    // Focus last filled input or the next empty one
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
        // Navigate to dashboard after brief success display
        setTimeout(() => {
          onSuccess();
        }, 1500);
      } else {
        setState('error');
        setErrorMessage(result.error || 'Falha ao vincular. Verifique o código e tente novamente.');
      }
    } catch (err) {
      setState('error');
      setErrorMessage(
        err instanceof Error ? err.message : 'Erro de conexão. Verifique sua internet.',
      );
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
          onClick={onBack}
          disabled={state === 'loading'}
          className="
            h-8 w-8 flex items-center justify-center
            rounded-lg hover:bg-gray-100 active:bg-gray-200
            text-gray-600 transition-colors
            disabled:opacity-40 disabled:pointer-events-none
          "
        >
          <ArrowLeft className="h-4 w-4" />
        </button>
        <h2 className="text-lg font-bold text-gray-900">Vincular ao OpenSea</h2>
      </div>

      <div className="flex-1 flex flex-col items-center">
        {/* Input State */}
        {(state === 'input' || state === 'loading') && (
          <>
            <p className="text-sm text-gray-500 text-center leading-relaxed mb-8 max-w-xs">
              Digite o código de pareamento exibido no painel de
              Impressoras Remotas do OpenSea.
            </p>

            {/* Code Input Boxes */}
            <div className="flex gap-2.5 mb-8" onPaste={handlePaste}>
              {digits.map((digit, i) => (
                <input
                  key={i}
                  ref={(el) => { inputRefs.current[i] = el; }}
                  type="text"
                  inputMode="numeric"
                  maxLength={1}
                  value={digit}
                  disabled={state === 'loading'}
                  onChange={(e) => handleInput(i, e.target.value)}
                  onKeyDown={(e) => handleKeyDown(i, e)}
                  className={`
                    h-14 w-12 text-center text-xl font-bold
                    rounded-xl border-2 bg-white
                    transition-all duration-150
                    focus:border-blue-500 focus:ring-4 focus:ring-blue-500/10
                    disabled:opacity-50 disabled:cursor-not-allowed
                    ${digit ? 'border-gray-300 text-gray-900' : 'border-gray-200 text-gray-400'}
                  `}
                />
              ))}
            </div>

            {/* Submit */}
            <button
              onClick={handleSubmit}
              disabled={!isComplete || state === 'loading'}
              className="
                w-full max-w-xs h-11 px-6
                bg-blue-600 hover:bg-blue-700 active:bg-blue-800
                disabled:bg-gray-200 disabled:text-gray-400
                text-white text-sm font-semibold
                rounded-xl shadow-sm
                transition-all duration-150
                focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-500 focus-visible:ring-offset-2
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

        {/* Success State */}
        {state === 'success' && (
          <div className="flex-1 flex flex-col items-center justify-center gap-4">
            <div className="h-16 w-16 rounded-full bg-emerald-50 flex items-center justify-center">
              <CheckCircle2 className="h-8 w-8 text-emerald-500" />
            </div>
            <div className="text-center">
              <h3 className="text-lg font-bold text-gray-900 mb-1">
                Vinculado com sucesso
              </h3>
              <p className="text-sm text-gray-500">
                Seu computador foi conectado ao OpenSea.
              </p>
            </div>
          </div>
        )}

        {/* Error State */}
        {state === 'error' && (
          <div className="flex-1 flex flex-col items-center justify-center gap-4">
            <div className="h-16 w-16 rounded-full bg-rose-50 flex items-center justify-center">
              <AlertCircle className="h-8 w-8 text-rose-500" />
            </div>
            <div className="text-center">
              <h3 className="text-lg font-bold text-gray-900 mb-1">
                Falha na vinculação
              </h3>
              <p className="text-sm text-gray-500 max-w-xs">
                {errorMessage}
              </p>
            </div>
            <button
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
