/**
 * Decoded local-DNA patch data, kept in memory between searches.
 *
 * A crop search compares the probe against every vault index of the owner. Loading those
 * indexes (tens of thousands of patch rows, or packed archives to inflate) was the largest
 * single cost of an investigation — repeated by every search call, for every probe variant,
 * although the data only changes when an asset is protected, re-indexed or deleted.
 *
 * Entries are keyed by index id and validated against the index row's `updatedAt` and
 * `patchCount`, so a rebuilt index is never served from a stale entry, and a deleted one
 * simply stops being asked for. Only decoded data is cached; what is compared and how is
 * unchanged.
 */

export interface CachedIndexPatches<T> {
  updatedAtMs: number;
  patchCount: number;
  patches: T[];
  prefixMap: Map<string, T[]>;
}

/** Bound on decoded patches held in memory (~400 B each in JS objects). */
const MAX_TOTAL_PATCHES = 600_000;

const entries = new Map<string, CachedIndexPatches<unknown>>();
let totalPatches = 0;

export function getCachedIndex<T>(
  indexId: string,
  updatedAt: Date,
  patchCount: number,
): CachedIndexPatches<T> | null {
  const hit = entries.get(indexId);
  if (!hit) return null;
  if (hit.updatedAtMs !== updatedAt.getTime() || hit.patchCount !== patchCount) {
    totalPatches -= hit.patches.length;
    entries.delete(indexId);
    return null;
  }
  // refresh recency
  entries.delete(indexId);
  entries.set(indexId, hit);
  return hit as CachedIndexPatches<T>;
}

export function putCachedIndex<T>(
  indexId: string,
  updatedAt: Date,
  patchCount: number,
  patches: T[],
  prefixMap: Map<string, T[]>,
): void {
  if (patches.length === 0 || patches.length > MAX_TOTAL_PATCHES) return;
  const prev = entries.get(indexId);
  if (prev) {
    totalPatches -= prev.patches.length;
    entries.delete(indexId);
  }
  entries.set(indexId, { updatedAtMs: updatedAt.getTime(), patchCount, patches, prefixMap });
  totalPatches += patches.length;
  while (totalPatches > MAX_TOTAL_PATCHES) {
    const oldest = entries.keys().next().value;
    if (oldest === undefined) break;
    totalPatches -= entries.get(oldest)!.patches.length;
    entries.delete(oldest);
  }
}

/** Test/maintenance hook. */
export function clearIndexCache(): void {
  entries.clear();
  totalPatches = 0;
}
