import { useState, useEffect, useCallback, useRef } from 'react';
import { formatApiError } from '../services/dashboard.api';

export interface ApiState<T> {
  data: T | null;
  loading: boolean;
  error: string | null;
  refetch: () => void;
}

/**
 * Generic data-fetching hook with loading, error, and refetch support.
 * Cancels stale requests when component unmounts or fn changes.
 */
export function useApi<T>(
  fn: () => Promise<T>,
  deps: unknown[] = []
): ApiState<T> {
  const [data,    setData]    = useState<T | null>(null);
  const [loading, setLoading] = useState(true);
  const [error,   setError]   = useState<string | null>(null);
  const abortRef = useRef(false);

  const execute = useCallback(async () => {
    abortRef.current = false;
    setLoading(true);
    setError(null);
    try {
      const result = await fn();
      if (!abortRef.current) setData(result);
    } catch (err) {
      if (!abortRef.current) {
        setError(formatApiError(err));
      }
    } finally {
      if (!abortRef.current) setLoading(false);
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, deps);

  useEffect(() => {
    execute();
    return () => { abortRef.current = true; };
  }, [execute]);

  return { data, loading, error, refetch: execute };
}

/** Format bytes to human-readable string */
export function formatBytes(bytes: number): string {
  if (bytes === 0) return '0 B';
  const k = 1024;
  const sizes = ['B', 'KB', 'MB', 'GB'];
  const i = Math.floor(Math.log(bytes) / Math.log(k));
  return `${(bytes / Math.pow(k, i)).toFixed(1)} ${sizes[i]}`;
}
