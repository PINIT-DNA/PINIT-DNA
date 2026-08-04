import { useState, useEffect, useCallback, useRef, type Dispatch, type SetStateAction } from 'react';
import { formatApiError } from '../services/dashboard.api';

const DEV_BACKEND_RETRY_MS = 1500;
const DEV_BACKEND_MAX_RETRIES = 4;

function isBackendOfflineError(err: unknown): boolean {
  const msg = formatApiError(err);
  return /backend offline|cannot reach api|service unavailable|backend waking up|4000/i.test(msg);
}

function delay(ms: number) {
  return new Promise((r) => setTimeout(r, ms));
}

export interface ApiState<T> {
  data: T | null;
  loading: boolean;
  error: string | null;
  refetch: () => void;
  setData: Dispatch<SetStateAction<T | null>>;
}

export interface UseApiOptions {
  /** Module-level cache key — revisits show cached data instantly. */
  cacheKey?: string;
  /** How long cached data stays fresh (default 30s). */
  staleTimeMs?: number;
}

const apiCache = new Map<string, { data: unknown; at: number }>();
const DEFAULT_STALE_MS = 30_000;

function readCache<T>(key: string, staleTimeMs: number): T | null {
  const hit = apiCache.get(key);
  if (!hit) return null;
  if (Date.now() - hit.at > staleTimeMs) return hit.data as T;
  return hit.data as T;
}

function writeCache<T>(key: string, data: T) {
  apiCache.set(key, { data, at: Date.now() });
}

export function invalidateApiCache(prefix?: string) {
  if (!prefix) {
    apiCache.clear();
    return;
  }
  for (const key of apiCache.keys()) {
    if (key.startsWith(prefix)) apiCache.delete(key);
  }
}

/**
 * Generic data-fetching hook with loading, error, and refetch support.
 * Cancels stale requests when component unmounts or fn changes.
 */
export function useApi<T>(
  fn: () => Promise<T>,
  deps: unknown[] = [],
  options?: UseApiOptions,
): ApiState<T> {
  const cacheKey = options?.cacheKey;
  const staleTimeMs = options?.staleTimeMs ?? DEFAULT_STALE_MS;
  const cachedInitial = cacheKey ? readCache<T>(cacheKey, staleTimeMs) : null;

  const [data,    setData]    = useState<T | null>(cachedInitial);
  const [loading, setLoading] = useState(!cachedInitial);
  const [error,   setError]   = useState<string | null>(null);
  const abortRef = useRef(false);
  const hasDataRef = useRef(cachedInitial != null);

  useEffect(() => {
    hasDataRef.current = data != null;
  }, [data]);

  const execute = useCallback(async () => {
    abortRef.current = false;
    // Keep current list visible while refreshing — avoids "delete didn't remove" flicker
    if (!hasDataRef.current) setLoading(true);
    setError(null);

    let lastErr: unknown;
    const maxAttempts = import.meta.env.DEV ? DEV_BACKEND_MAX_RETRIES : 4;

    for (let attempt = 0; attempt < maxAttempts; attempt++) {
      if (abortRef.current) return;
      try {
        const result = await fn();
        if (!abortRef.current) {
          setData(result);
          if (cacheKey) writeCache(cacheKey, result);
          setError(null);
          setLoading(false);
        }
        return;
      } catch (err) {
        lastErr = err;
        const offline = isBackendOfflineError(err);
        if (!offline || attempt >= maxAttempts - 1 || abortRef.current) break;
        await delay(import.meta.env.PROD ? 6000 + attempt * 2000 : DEV_BACKEND_RETRY_MS);
      }
    }

    if (!abortRef.current && lastErr) {
      setError(formatApiError(lastErr));
      setLoading(false);
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, deps);

  useEffect(() => {
    execute();
    return () => { abortRef.current = true; };
  }, [execute]);

  return { data, loading, error, refetch: execute, setData };
}

/** Format bytes to human-readable string */
export function formatBytes(bytes: number): string {
  if (bytes === 0) return '0 B';
  const k = 1024;
  const sizes = ['B', 'KB', 'MB', 'GB'];
  const i = Math.floor(Math.log(bytes) / Math.log(k));
  return `${(bytes / Math.pow(k, i)).toFixed(1)} ${sizes[i]}`;
}
