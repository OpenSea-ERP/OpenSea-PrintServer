import { useCallback, useEffect, useRef, useState } from 'react';

const IPC_TIMEOUT_MS = 30_000;

/**
 * Invoca um canal IPC com timeout global. Impede UI congelada caso o main trave.
 */
export async function invokeIpc<T = unknown>(channel: string, ...args: unknown[]): Promise<T> {
  if (!window.electronAPI) {
    throw new Error('electronAPI indisponível — rodando fora do Electron?');
  }

  return Promise.race<T>([
    window.electronAPI.invoke<T>(channel, ...args),
    new Promise<T>((_, reject) =>
      setTimeout(
        () => reject(new Error(`IPC timeout após ${IPC_TIMEOUT_MS}ms no canal "${channel}"`)),
        IPC_TIMEOUT_MS,
      ),
    ),
  ]);
}

/**
 * React hook para IPC com loading/error/refetch.
 */
export function useIpc<T = unknown>(channel: string, ...args: unknown[]) {
  const [data, setData] = useState<T | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const mountedRef = useRef(true);

  const fetch = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const result = await invokeIpc<T>(channel, ...args);
      if (mountedRef.current) {
        setData(result);
      }
    } catch (err) {
      if (mountedRef.current) {
        setError(err instanceof Error ? err.message : String(err));
      }
    } finally {
      if (mountedRef.current) {
        setLoading(false);
      }
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [channel, args]);

  useEffect(() => {
    mountedRef.current = true;
    fetch();
    return () => {
      mountedRef.current = false;
    };
  }, [fetch]);

  return { data, loading, error, refetch: fetch };
}

/**
 * Subscreve a um canal IPC. Mantém identity do handler estável via ref —
 * evita vazamento de listeners quando o caller passa um handler inline novo a cada render.
 */
export function useIpcEvent<T = unknown>(channel: string, handler: (data: T) => void) {
  const handlerRef = useRef(handler);

  useEffect(() => {
    handlerRef.current = handler;
  }, [handler]);

  useEffect(() => {
    if (!window.electronAPI) return;
    const unsubscribe = window.electronAPI.on(channel, (data) => {
      handlerRef.current(data as T);
    });
    return unsubscribe;
  }, [channel]);
}
