/**
 * Lifecycle read side.
 *
 * Reads what already exists rather than storing a third copy of it:
 *  - platform_events rows stamped with a lifecycle type (the lifecycle layer), and
 *  - asset_timeline_events, which Hub protect and the Exchange activity bridge
 *    already write and which Asset 360 already reads.
 *
 * Ownership is enforced in the asset lookup itself, so an asset belonging to someone
 * else is indistinguishable from one that does not exist — the same rule Asset 360
 * follows. Payloads go through the existing scrubber before they leave the server.
 */
import { prisma } from '../../lib/prisma';
import { logger } from '../../lib/logger';
import { scrubPayload } from '../assets/asset-activity.service';
import {
  LIFECYCLE_STAGES,
  LIFECYCLE_STAGE_OF,
  LIFECYCLE_LABEL,
  LIFECYCLE_TYPES_NOT_EMITTED,
  lifecycleTypeForTimelineEvent,
  isLifecycleType,
  type LifecycleStage,
  type LifecycleType,
} from './lifecycle-types';

/** Two events of the same kind this close together are one action seen twice. */
const DUPLICATE_WINDOW_MS = 120_000;
const DEFAULT_LIMIT = 200;

export interface LifecycleEvent {
  id: string;
  at: Date;
  type: LifecycleType;
  stage: LifecycleStage;
  label: string;
  title: string;
  detail: string | null;
  source: 'lifecycle' | 'timeline';
  payload?: Record<string, unknown> | null;
}

export interface VideoFrameDnaSummary {
  framesProtected: number;
  everyFrame: boolean;
  frameMerkleRoot: string | null;
  decoder: string | null;
  width: number | null;
  height: number | null;
  fps: number | null;
  patchesPerFrame: number | null;
}

export interface AssetLifecycleReport {
  asset: {
    id: string;
    filename: string;
    assetType: string;
    status: string;
    protectedAt: Date;
  };
  events: LifecycleEvent[];
  countsByStage: Record<LifecycleStage, number>;
  /** Present for videos that have compact per-frame DNA. Forensic detail, not activity. */
  frameDna: VideoFrameDnaSummary | null;
  /** Lifecycle types this platform cannot observe yet — never faked, always declared. */
  notEmitted: readonly LifecycleType[];
}

function emptyCounts(): Record<LifecycleStage, number> {
  return LIFECYCLE_STAGES.reduce(
    (acc, stage) => ({ ...acc, [stage]: 0 }),
    {} as Record<LifecycleStage, number>,
  );
}

function toEvent(
  id: string,
  at: Date,
  type: LifecycleType,
  title: string,
  detail: string | null,
  source: LifecycleEvent['source'],
  payload: unknown,
): LifecycleEvent {
  const cleaned = payload ? (scrubPayload(payload) as Record<string, unknown>) : null;
  return {
    id,
    at,
    type,
    stage: LIFECYCLE_STAGE_OF[type],
    label: LIFECYCLE_LABEL[type],
    title,
    detail,
    source,
    payload: cleaned && Object.keys(cleaned).length ? cleaned : null,
  };
}

/**
 * The same real action can appear in both stores — a share view is a platform event
 * AND an AssetTimelineEvent written by the share service. Keep one.
 */
function dropDuplicates(events: LifecycleEvent[]): LifecycleEvent[] {
  const kept: LifecycleEvent[] = [];
  for (const event of events) {
    const duplicate = kept.some(
      (k) => k.type === event.type
        && Math.abs(k.at.getTime() - event.at.getTime()) <= DUPLICATE_WINDOW_MS,
    );
    if (!duplicate) kept.push(event);
  }
  return kept;
}

async function frameDnaSummary(dnaRecordId: string | null): Promise<VideoFrameDnaSummary | null> {
  if (!dnaRecordId) return null;
  try {
    const [framesProtected, dna] = await Promise.all([
      prisma.videoFrameDna.count({ where: { videoDnaRecordId: dnaRecordId } }),
      prisma.dnaRecord.findUnique({
        where: { id: dnaRecordId },
        select: { universalFingerprints: true },
      }),
    ]);
    if (!framesProtected) return null;

    const fingerprints = (dna?.universalFingerprints ?? null) as Record<string, unknown> | null;
    const summary = (fingerprints?.['videoFrameDna'] ?? null) as Record<string, unknown> | null;
    const num = (v: unknown): number | null => (typeof v === 'number' && Number.isFinite(v) ? v : null);
    const str = (v: unknown): string | null => (typeof v === 'string' && v ? v : null);

    return {
      framesProtected,
      everyFrame: summary?.['everyFrame'] === true,
      frameMerkleRoot: str(summary?.['frameMerkleRoot']),
      decoder: str(summary?.['decoder']),
      width: num(summary?.['width']),
      height: num(summary?.['height']),
      fps: num(summary?.['fps']),
      patchesPerFrame: num(summary?.['patchesPerFrame']),
    };
  } catch (err) {
    // The table arrives with ensure-lifecycle-tracking; until then, no summary.
    logger.debug('[Lifecycle] Frame DNA summary unavailable', { error: String(err) });
    return null;
  }
}

/**
 * Full lifecycle of one asset the caller owns.
 * Returns null when the asset does not exist OR belongs to someone else.
 */
export async function getAssetLifecycle(
  assetId: string,
  ownerUserId: string,
  options?: { limit?: number },
): Promise<AssetLifecycleReport | null> {
  const id = String(assetId || '').trim();
  const owner = String(ownerUserId || '').trim();
  if (!id || !owner) return null;

  const asset = await prisma.asset.findFirst({
    where: { id, ownerUserId: owner },
    select: {
      id: true,
      originalFilename: true,
      assetType: true,
      status: true,
      createdAt: true,
      dnaId: true,
    },
  });
  if (!asset) return null;

  const limit = Math.min(Math.max(options?.limit ?? DEFAULT_LIMIT, 1), 500);

  const [lifecycleRows, timelineRows, frameDna] = await Promise.all([
    prisma.platformEvent.findMany({
      where: { ownerUserId: owner, assetId: id, lifecycleType: { not: null } },
      orderBy: { createdAt: 'desc' },
      take: limit,
      select: {
        id: true,
        createdAt: true,
        lifecycleType: true,
        title: true,
        body: true,
        payload: true,
      },
    }),
    prisma.assetTimelineEvent.findMany({
      where: { assetId: id },
      orderBy: { createdAt: 'desc' },
      take: limit,
      select: {
        id: true,
        createdAt: true,
        eventType: true,
        title: true,
        detail: true,
        payload: true,
      },
    }),
    frameDnaSummary(asset.dnaId),
  ]);

  const events: LifecycleEvent[] = [];

  for (const row of lifecycleRows) {
    if (!isLifecycleType(row.lifecycleType)) continue;
    events.push(toEvent(row.id, row.createdAt, row.lifecycleType, row.title, row.body, 'lifecycle', row.payload));
  }
  for (const row of timelineRows) {
    const type = lifecycleTypeForTimelineEvent(String(row.eventType));
    if (!type) continue;
    events.push(toEvent(row.id, row.createdAt, type, row.title, row.detail, 'timeline', row.payload));
  }

  events.sort((a, b) => b.at.getTime() - a.at.getTime());
  const deduped = dropDuplicates(events).slice(0, limit);

  const countsByStage = emptyCounts();
  for (const event of deduped) countsByStage[event.stage] += 1;

  return {
    asset: {
      id: asset.id,
      filename: asset.originalFilename,
      assetType: String(asset.assetType),
      status: String(asset.status),
      protectedAt: asset.createdAt,
    },
    events: deduped,
    countsByStage,
    frameDna,
    notEmitted: LIFECYCLE_TYPES_NOT_EMITTED,
  };
}

/** Everything that happened across the caller's own assets and account. */
export async function getOwnerLifecycle(
  ownerUserId: string,
  options?: { limit?: number; stage?: LifecycleStage },
): Promise<LifecycleEvent[]> {
  const owner = String(ownerUserId || '').trim();
  if (!owner) return [];

  const limit = Math.min(Math.max(options?.limit ?? 50, 1), 200);
  const rows = await prisma.platformEvent.findMany({
    where: { ownerUserId: owner, lifecycleType: { not: null } },
    orderBy: { createdAt: 'desc' },
    take: limit * 2,
    select: {
      id: true,
      createdAt: true,
      lifecycleType: true,
      title: true,
      body: true,
      payload: true,
    },
  });

  const events: LifecycleEvent[] = [];
  for (const row of rows) {
    if (!isLifecycleType(row.lifecycleType)) continue;
    const event = toEvent(row.id, row.createdAt, row.lifecycleType, row.title, row.body, 'lifecycle', row.payload);
    if (options?.stage && event.stage !== options.stage) continue;
    events.push(event);
  }
  return events.slice(0, limit);
}
