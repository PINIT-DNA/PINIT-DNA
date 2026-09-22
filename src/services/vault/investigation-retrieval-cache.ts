/**
 * Per-investigation cache of decrypted vault originals.
 *
 * One investigation asks for the same vault original from many stages (crop search,
 * fragment splice, spatial auth, video recovery, evidence…). Each ask was a database
 * read, a Supabase download and an AES-GCM decrypt — the same file fetched ~10 times.
 *
 * The cache exists only inside `withRetrievalCache`, so it lives exactly as long as one
 * investigation and can never serve a stale file to a later request. Outside a scope
 * `cachedRetrieve` is a plain pass-through.
 *
 * The key includes the requesting user, so a cached original is only ever returned to
 * the user whose ownership check produced it.
 */
import { AsyncLocalStorage } from 'async_hooks';

/** A single original larger than this is not retained (still shared while in flight). */
const MAX_ENTRY_BYTES = 32 * 1024 * 1024;
/** Upper bound on originals retained at once by one investigation. */
const MAX_TOTAL_BYTES = 192 * 1024 * 1024;

interface Scope {
  entries: Map<string, Promise<unknown>>;
  bytes: number;
}

const store = new AsyncLocalStorage<Scope>();

export function withRetrievalCache<T>(fn: () => Promise<T>): Promise<T> {
  // A nested call reuses the outer scope.
  if (store.getStore()) return fn();
  return store.run({ entries: new Map(), bytes: 0 }, fn);
}

/**
 * Load once per (user, vault) inside a scope. The promise itself is stored, so
 * concurrent stages asking at the same moment share one fetch. A failed load is
 * evicted so a later stage can retry.
 */
export function cachedRetrieve<T extends { originalBuffer: Buffer }>(
  requestingUserId: string,
  vaultId: string,
  load: () => Promise<T>,
): Promise<T> {
  const scope = store.getStore();
  if (!scope) return load();

  const key = `${requestingUserId}:${vaultId}`;
  const hit = scope.entries.get(key);
  if (hit) return hit as Promise<T>;

  const pending = load().then(
    (result) => {
      const size = result.originalBuffer.length;
      if (size > MAX_ENTRY_BYTES || scope.bytes + size > MAX_TOTAL_BYTES) {
        scope.entries.delete(key); // too big to keep; callers already in flight still share it
      } else {
        scope.bytes += size;
      }
      return result;
    },
    (err) => {
      scope.entries.delete(key);
      throw err;
    },
  );
  scope.entries.set(key, pending);
  return pending;
}

/**
 * Run an expensive, deterministic computation once per investigation.
 *
 * Several stages ask the AI sidecar the same question about the same probe (e.g. a forensic
 * scan of the uploaded file with no reference). Inside `withRetrievalCache` the first
 * caller computes and the rest share its promise; outside a scope this is a plain call.
 * Results the caller deems not worth keeping (failures, "service unavailable") are dropped
 * so a later stage can try again. `clone` protects the shared value from callers that
 * mutate what they receive.
 */
export function memoizeInInvestigation<T>(
  key: string,
  compute: () => Promise<T>,
  options?: { keep?: (value: T) => boolean; clone?: (value: T) => T },
): Promise<T> {
  const scope = store.getStore();
  if (!scope) return compute();
  const memoKey = `memo:${key}`;
  const clone = options?.clone ?? ((v: T) => v);
  const hit = scope.entries.get(memoKey);
  if (hit) return (hit as Promise<T>).then(clone);

  const pending = compute().then(
    (value) => {
      if (options?.keep && !options.keep(value)) scope.entries.delete(memoKey);
      return value;
    },
    (err) => {
      scope.entries.delete(memoKey);
      throw err;
    },
  );
  scope.entries.set(memoKey, pending);
  return pending.then(clone);
}
