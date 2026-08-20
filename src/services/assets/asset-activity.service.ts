/**
 * Canonical asset activity recorder (Phase 2).
 *
 * Every asset-level event — Hub-side or Exchange-side — lands in
 * `AssetTimelineEvent`, keyed on the canonical `Asset.id`. This is the single
 * append-only timeline that Asset 360 (Phase 3) reads from.
 *
 * Rules enforced here, not left to callers:
 *  - Events are keyed on Asset.id only. A VaultRecord.id or DnaRecord.id is
 *    rejected, never silently written.
 *  - Recording is best-effort: an audit write must never fail a checkout, a
 *    delivery, or a cart update.
 *  - Payloads are scrubbed of buyer PII and secrets before they are persisted,
 *    because Phase 3 surfaces this timeline to the creator.
 *  - Nothing is ever backfilled from a counter. An event exists only because
 *    the real action happened.
 */
import { prisma } from '../../lib/prisma';
import { logger } from '../../lib/logger';
import type { AssetTimelineType } from '@prisma/client';

/**
 * Keys that must never reach the timeline payload. The creator can read this
 * data in Asset 360, so buyer identity, precise location, device fingerprints,
 * raw network identifiers and gateway/payment references are all stripped.
 *
 * Matching is case-insensitive and substring-based so variants like
 * `buyer_email`, `buyerEmail` and `razorpay_payment_id` are all caught.
 */
const FORBIDDEN_PAYLOAD_KEYS = [
  'email',
  'password',
  'token',
  'secret',
  'apikey',
  'api_key',
  'authorization',
  'ip',
  'ipaddress',
  'ip_address',
  'useragent',
  'user_agent',
  'fingerprint',
  'device_fingerprint',
  'deviceid',
  'latitude',
  'longitude',
  'gps',
  'accuracy',
  'razorpay',
  'payment_id',
  'paymentid',
  'card',
  'signature',
  'buyer_name',
  'buyername',
  'buyer_org',
  'buyerorg',
  'organization',
  'riskscore',
  'risk_score',
  'riskfactors',
];

function isForbiddenKey(key: string): boolean {
  const k = key.toLowerCase().replace(/[^a-z_]/g, '');
  return FORBIDDEN_PAYLOAD_KEYS.some((f) => k === f || k.includes(f.replace(/_/g, '')));
}

/**
 * Recursively drop forbidden keys. Depth-capped so a hostile or accidentally
 * cyclic payload cannot blow the stack.
 */
export function scrubPayload(value: unknown, depth = 0): unknown {
  if (depth > 6) return undefined;
  if (value === null || value === undefined) return value;
  if (Array.isArray(value)) {
    return value.map((v) => scrubPayload(v, depth + 1)).filter((v) => v !== undefined);
  }
  if (typeof value === 'object') {
    const out: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(value as Record<string, unknown>)) {
      if (isForbiddenKey(k)) continue;
      const cleaned = scrubPayload(v, depth + 1);
      if (cleaned !== undefined) out[k] = cleaned;
    }
    return out;
  }
  return value;
}

export interface AssetActivityInput {
  assetId: string | null | undefined;
  eventType: AssetTimelineType;
  title: string;
  detail?: string | null;
  payload?: Record<string, unknown> | null;
  /** Optional provenance/forensics fields already modelled on the timeline. */
  platform?: string | null;
  url?: string | null;
}

/**
 * Record one asset activity event. Returns true when a row was written.
 *
 * Never throws — callers sit on commerce paths where an audit failure must not
 * surface to the user.
 */
export async function recordAssetActivity(input: AssetActivityInput): Promise<boolean> {
  const assetId = String(input.assetId || '').trim();
  if (!assetId) return false;

  try {
    // Reject anything that is not a real Asset.id. This is what stops a
    // VaultRecord.id or DnaRecord.id being written as an asset key.
    const asset = await prisma.asset.findUnique({
      where: { id: assetId },
      select: { id: true },
    });
    if (!asset) {
      logger.warn('[AssetActivity] Ignored event for unknown Asset.id', {
        assetId,
        eventType: input.eventType,
      });
      return false;
    }

    const payload = input.payload ? (scrubPayload(input.payload) as Record<string, unknown>) : undefined;

    await prisma.assetTimelineEvent.create({
      data: {
        assetId: asset.id,
        eventType: input.eventType,
        title: input.title,
        detail: input.detail ?? null,
        platform: input.platform ?? null,
        url: input.url ?? null,
        payload: (payload ?? undefined) as never,
      },
    });
    return true;
  } catch (err) {
    logger.warn('[AssetActivity] Event skipped (non-fatal)', {
      assetId,
      eventType: input.eventType,
      error: String(err),
    });
    return false;
  }
}

/**
 * Record several events. Each is independent — one failure does not stop the
 * rest, which matters for the Exchange batch bridge.
 */
export async function recordAssetActivityBatch(
  events: AssetActivityInput[],
): Promise<{ recorded: number; skipped: number }> {
  let recorded = 0;
  let skipped = 0;
  for (const e of events) {
    if (await recordAssetActivity(e)) recorded += 1;
    else skipped += 1;
  }
  return { recorded, skipped };
}
