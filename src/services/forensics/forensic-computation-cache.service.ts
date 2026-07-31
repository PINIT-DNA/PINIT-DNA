/**
 * In-memory cache for expensive forensic computations (per probe SHA-256).
 * TTL-based LRU — safe for single-instance; resets on process restart.
 */
import crypto from 'crypto';
import { logger } from '../../lib/logger';

type CacheNamespace =
  | 'perceptual'
  | 'structural'
  | 'semantic-color'
  | 'probe-patches'
  | 'ocr'
  | 'embedding'
  | 'orb-compare';

interface CacheEntry<T> {
  value: T;
  expiresAt: number;
}

const DEFAULT_TTL_MS = 15 * 60 * 1000; // 15 min
const MAX_ENTRIES = 200;

class ForensicComputationCache {
  private readonly store = new Map<string, CacheEntry<unknown>>();

  private key(buffer: Buffer, namespace: CacheNamespace, extra?: string): string {
    const hash = crypto.createHash('sha256').update(buffer).digest('hex');
    return extra ? `${hash}:${namespace}:${extra}` : `${hash}:${namespace}`;
  }

  get<T>(buffer: Buffer, namespace: CacheNamespace, extra?: string): T | null {
    const k = this.key(buffer, namespace, extra);
    const entry = this.store.get(k);
    if (!entry) return null;
    if (Date.now() > entry.expiresAt) {
      this.store.delete(k);
      return null;
    }
    return entry.value as T;
  }

  set<T>(buffer: Buffer, namespace: CacheNamespace, value: T, extra?: string, ttlMs = DEFAULT_TTL_MS): void {
    if (this.store.size >= MAX_ENTRIES) {
      const oldest = this.store.keys().next().value;
      if (oldest) this.store.delete(oldest);
    }
    const k = this.key(buffer, namespace, extra);
    this.store.set(k, { value, expiresAt: Date.now() + ttlMs });
  }

  async getOrCompute<T>(
    buffer: Buffer,
    namespace: CacheNamespace,
    compute: () => Promise<T>,
    extra?: string,
  ): Promise<T> {
    const cached = this.get<T>(buffer, namespace, extra);
    if (cached !== null) return cached;
    const value = await compute();
    this.set(buffer, namespace, value, extra);
    return value;
  }

  stats(): { size: number; maxEntries: number } {
    return { size: this.store.size, maxEntries: MAX_ENTRIES };
  }

  logHit(namespace: CacheNamespace): void {
    logger.debug('[ForensicCache] hit', { namespace, ...this.stats() });
  }
}

export const forensicComputationCache = new ForensicComputationCache();
