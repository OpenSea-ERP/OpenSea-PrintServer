import { useState, useEffect, useCallback, useRef } from 'react';

/**
 * Invoke an IPC channel and return a promise.
 */
export async function invokeIpc<T = unknown>(
  channel: string,
  ...args: unknown[]
): Promise<T> {
  if (!window.electronAPI) {
    throw new Error('electronAPI not available — running outside Electron?');
  }
  return window.electronAPI.invoke<T>(channel, ...args);
}

/**
 * React hook for IPC calls with loading/error states and refetch.
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
  }, [channel, JSON.stringify(args)]);

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
 * Subscribe to an IPC event channel. Returns cleanup automatically.
 */
export function useIpcEvent<T = unknown>(
  channel: string,
  handler: (data: T) => void,
) {
  useEffect(() => {
    if (!window.electronAPI) return;
    const unsubscribe = window.electronAPI.on(channel, (data) => {
      handler(data as T);
    });
    return unsubscribe;
  }, [channel, handler]);
}
