/**
 * Asset tracking — one asset, every channel it travelled through.
 *
 * The question this answers is "what happened to this file?", which until now had
 * to be assembled by hand from four screens: Sharing listed links, Asset Activity
 * listed DNA records, Credentials listed certificates, and the sales lived in
 * Exchange. Ocean.jpg alone is six share links, so the same asset appeared six
 * times and its certificate checks appeared nowhere.
 *
 * Nothing here writes, and nothing new is counted: every figure comes from a table
 * that already records a real action.
 *
 * Ownership is resolved by the caller from the JWT and scoped into every query —
 * an asset belonging to someone else is indistinguishable from one that does not
 * exist, the same rule Asset 360 follows.
 *
 * Share links are attributed to an asset at READ time, by Asset.id when the link
 * carries one and otherwise through the vault or DNA record it was made from.
 * Most links predate `ShareLink.assetId` (6 of 31 carry it), so resolving on read
 * keeps every historical link visible without rewriting rows.
 */
import { prisma } from '../../lib/prisma';
import { logger } from '../../lib/logger';

/** A count that could not be read is null, never 0 — silence and zero differ. */
export type Count = number | null;

export interface TrackedAssetRow {
  assetId: string;
  filename: string;
  assetType: string;
  status: string;
  protectedAt: Date;
  certificateId: string | null;
  channels: {
    shares: number;
    reshares: number;
    shareViews: number;
    screenshotAttempts: number;
    certificateChecks: Count;
    portfolioViews: Count;
    purchases: Count;
    foundOnline: number;
  };
  lastActivityAt: Date | null;
}

export interface TrackedShare {
  shareLinkId: string;
  token: string;
  recipient: string | null;
  createdAt: Date;
  isActive: boolean;
  expiresAt: Date | null;
  /** Set when this link is someone forwarding a link they received. */
  parentLinkId: string | null;
  forwardedByLabel: string | null;
  /** Created by an Exchange purchase rather than by the owner sharing. */
  fromExchange: boolean;
  views: number;
  downloads: number;
  screenshotAttempts: number;
  viewers: number;
  lastSeenAt: Date | null;
  country: string | null;
}

export interface AssetTrackingReport {
  asset: {
    assetId: string;
    filename: string;
    assetType: string;
    status: string;
    mimeType: string;
    sizeBytes: number;
    protectedAt: Date;
    monitorStatus: string;
  };
  certificate: {
    certificateId: string;
    status: string;
    issuedAt: Date;
    expiresAt: Date | null;
    revokedAt: Date | null;
    checks: Count;
    lastCheckedAt: Date | null;
  } | null;
  shares: TrackedShare[];
  purchases: Array<{
    orderId: string | null;
    sealId: string | null;
    buyerPinitId: string | null;
    licenseTier: string | null;
    licenseStatus: string | null;
    deliveryStatus: string | null;
    sealedAt: Date | null;
    deliveryExpiresAt: Date | null;
  }>;
  portfolio: { shown: boolean; views: Count };
  monitoring: { status: string; foundOnline: number; lastDiscoveryAt: Date | null };
  evidence: { records: number; investigations: number };
  /** Channels whose data could not be read, so the UI can say so instead of showing 0. */
  unavailable: string[];
}

/** Links belong to an asset by Asset.id, or through the vault or DNA behind it. */
const LINK_MATCHES_ASSET = `(
  s."assetId" = a.id
  OR (a."vaultId" IS NOT NULL AND s."vaultId" = a."vaultId")
  OR (a."dnaId" IS NOT NULL AND s."dnaRecordId" = a."dnaId")
)`;

async function safeRows<T>(label: string, sql: string, ...params: unknown[]): Promise<T[] | null> {
  try {
    return await prisma.$queryRawUnsafe<T[]>(sql, ...params);
  } catch (err) {
    // Exchange may be unreachable, and the lifecycle columns arrive with
    // ensure-lifecycle-tracking. Either way the rest of the page still answers.
    logger.warn(`[AssetTracking] ${label} unavailable`, { error: String(err) });
    return null;
  }
}

const num = (v: unknown): number => {
  const n = Number(v ?? 0);
  return Number.isFinite(n) ? n : 0;
};

/**
 * Every protected asset of one owner, with what happened to each.
 *
 * One row per asset — never one per share link, which is what made the same file
 * appear six times.
 */
export async function listTrackedAssets(
  ownerUserId: string,
  options?: { limit?: number },
): Promise<TrackedAssetRow[]> {
  const owner = String(ownerUserId || '').trim();
  if (!owner) return [];
  const limit = Math.min(Math.max(options?.limit ?? 100, 1), 300);

  const base = await prisma.$queryRawUnsafe<Array<Record<string, unknown>>>(
    `SELECT a.id,
            a."originalFilename",
            a."assetType"::text   AS asset_type,
            a.status::text        AS status,
            a."createdAt",
            a."certificateId",
            a."lastDiscoveryAt",
            a."discoveriesCount",
            (SELECT COUNT(*) FROM share_links s
              WHERE ${LINK_MATCHES_ASSET} AND s."parentLinkId" IS NULL)     AS shares,
            (SELECT COUNT(*) FROM share_links s
              WHERE ${LINK_MATCHES_ASSET} AND s."parentLinkId" IS NOT NULL) AS reshares,
            (SELECT COUNT(*) FROM share_access_logs l
               JOIN share_links s ON s.id = l."shareLinkId"
              WHERE ${LINK_MATCHES_ASSET} AND l.action = 'VIEWED')             AS share_views,
            (SELECT COUNT(*) FROM share_access_logs l
               JOIN share_links s ON s.id = l."shareLinkId"
              WHERE ${LINK_MATCHES_ASSET} AND l.action = 'SCREENSHOT_ATTEMPT') AS screenshot_attempts,
            (SELECT MAX(l."createdAt") FROM share_access_logs l
               JOIN share_links s ON s.id = l."shareLinkId"
              WHERE ${LINK_MATCHES_ASSET})                                     AS last_share_activity
       FROM assets a
      WHERE a."ownerUserId" = $1
      ORDER BY a."createdAt" DESC
      LIMIT ${limit}`,
    owner,
  );

  const assetIds = base.map((r) => String(r['id']));
  const unavailable: string[] = [];

  const lifecycle = assetIds.length
    ? await safeRows<{ asset_id: string; lifecycle_type: string; n: bigint }>(
        'certificate checks',
        `SELECT "assetId" AS asset_id, "lifecycleType" AS lifecycle_type, COUNT(*) AS n
           FROM platform_events
          WHERE "ownerUserId" = $1 AND "assetId" = ANY($2::text[])
            AND "lifecycleType" IN ('CERTIFICATE_VERIFIED')
          GROUP BY 1, 2`,
        owner,
        assetIds,
      )
    : [];
  if (lifecycle === null) unavailable.push('certificate checks');

  const purchases = assetIds.length
    ? await safeRows<{ asset_id: string; n: bigint }>(
        'purchases',
        `SELECT asset_id, COUNT(*) AS n FROM exchange.orders_sealed
          WHERE asset_id = ANY($1::text[]) GROUP BY asset_id`,
        assetIds,
      )
    : [];
  if (purchases === null) unavailable.push('purchases');

  const checksByAsset = new Map<string, number>();
  for (const row of lifecycle ?? []) checksByAsset.set(row.asset_id, num(row.n));
  const purchasesByAsset = new Map<string, number>();
  for (const row of purchases ?? []) purchasesByAsset.set(row.asset_id, num(row.n));

  return base.map((r) => {
    const id = String(r['id']);
    const lastShare = r['last_share_activity'] ? new Date(r['last_share_activity'] as string) : null;
    const lastDiscovery = r['lastDiscoveryAt'] ? new Date(r['lastDiscoveryAt'] as string) : null;
    return {
      assetId: id,
      filename: String(r['originalFilename'] ?? ''),
      assetType: String(r['asset_type'] ?? 'OTHER'),
      status: String(r['status'] ?? ''),
      protectedAt: new Date(r['createdAt'] as string),
      certificateId: (r['certificateId'] as string | null) ?? null,
      channels: {
        shares: num(r['shares']),
        reshares: num(r['reshares']),
        shareViews: num(r['share_views']),
        screenshotAttempts: num(r['screenshot_attempts']),
        certificateChecks: lifecycle === null ? null : (checksByAsset.get(id) ?? 0),
        portfolioViews: null, // portfolio views are per portfolio, not per asset — see getAssetTracking
        purchases: purchases === null ? null : (purchasesByAsset.get(id) ?? 0),
        foundOnline: num(r['discoveriesCount']),
      },
      lastActivityAt: [lastShare, lastDiscovery]
        .filter((d): d is Date => !!d)
        .sort((x, y) => y.getTime() - x.getTime())[0] ?? null,
    };
  });
}

/**
 * One asset in full. Returns null when the asset does not exist OR belongs to
 * someone else — the two are deliberately indistinguishable.
 */
export async function getAssetTracking(
  assetId: string,
  ownerUserId: string,
): Promise<AssetTrackingReport | null> {
  const id = String(assetId || '').trim();
  const owner = String(ownerUserId || '').trim();
  if (!id || !owner) return null;

  const asset = await prisma.asset.findFirst({
    where: { id, ownerUserId: owner },
    select: {
      id: true, originalFilename: true, assetType: true, status: true, mimeType: true,
      sizeBytes: true, createdAt: true, monitorStatus: true, vaultId: true, dnaId: true,
      discoveriesCount: true, lastDiscoveryAt: true,
    },
  });
  if (!asset) return null;

  const unavailable: string[] = [];

  const [shareRows, certificate, purchases, portfolio, evidence, lifecycleChecks] = await Promise.all([
    prisma.$queryRawUnsafe<Array<Record<string, unknown>>>(
      `SELECT s.id, s.token, s."recipientLabel", s."recipientEmail", s."createdAt", s."isActive",
              s."expiresAt", s."parentLinkId", s."forwardedByLabel", s."sourceContext",
              (SELECT COUNT(*) FROM share_access_logs l WHERE l."shareLinkId" = s.id AND l.action = 'VIEWED')             AS views,
              (SELECT COUNT(*) FROM share_access_logs l WHERE l."shareLinkId" = s.id AND l.action = 'DOWNLOADED')         AS downloads,
              (SELECT COUNT(*) FROM share_access_logs l WHERE l."shareLinkId" = s.id AND l.action = 'SCREENSHOT_ATTEMPT') AS screenshot_attempts,
              (SELECT COUNT(DISTINCT COALESCE(l."deviceFingerprint", l."sessionId", l.id::text)) FROM share_access_logs l WHERE l."shareLinkId" = s.id) AS viewers,
              (SELECT MAX(l."createdAt") FROM share_access_logs l WHERE l."shareLinkId" = s.id)  AS last_seen,
              (SELECT l.country FROM share_access_logs l WHERE l."shareLinkId" = s.id AND l.country IS NOT NULL
                ORDER BY l."createdAt" DESC LIMIT 1) AS country
         FROM share_links s, assets a
        WHERE a.id = $1 AND a."ownerUserId" = $2 AND ${LINK_MATCHES_ASSET}
        ORDER BY s."createdAt" DESC`,
      id,
      owner,
    ).catch((err) => {
      logger.warn('[AssetTracking] shares unavailable', { error: String(err) });
      unavailable.push('shares');
      return [] as Array<Record<string, unknown>>;
    }),

    prisma.certificate.findFirst({
      where: {
        OR: [
          { assetId: id },
          ...(asset.vaultId ? [{ vaultId: asset.vaultId }] : []),
          ...(asset.dnaId ? [{ dnaRecordId: asset.dnaId }] : []),
        ],
      },
      orderBy: { createdAt: 'desc' },
      select: {
        certificateId: true, status: true, issuedAt: true, expiresAt: true, revokedAt: true,
      },
    }),

    safeRows<Record<string, unknown>>(
      'purchases',
      `SELECT order_id, seal_id, buyer_pinit_id, license_tier, license_status,
              delivery_status, sealed_at, delivery_expires_at
         FROM exchange.orders_sealed WHERE asset_id = $1 ORDER BY sealed_at DESC`,
      id,
    ),

    prisma.portfolioProjectMedia.findFirst({
      where: { OR: [{ assetId: id }, ...(asset.vaultId ? [{ vaultId: asset.vaultId }] : [])] },
      select: { id: true },
    }).catch(() => null),

    Promise.all([
      prisma.evidenceRecord.count({ where: { ownerUserId: owner, dnaRecordId: asset.dnaId } }).catch(() => 0),
      prisma.incident.count({ where: { assetId: id } }).catch(() => 0),
    ]),

    safeRows<{ n: bigint; last_at: Date | null }>(
      'certificate checks',
      `SELECT COUNT(*) AS n, MAX("createdAt") AS last_at
         FROM platform_events
        WHERE "ownerUserId" = $1 AND "assetId" = $2 AND "lifecycleType" = 'CERTIFICATE_VERIFIED'`,
      owner,
      id,
    ),
  ]);

  if (purchases === null) unavailable.push('purchases');
  if (lifecycleChecks === null) unavailable.push('certificate checks');

  // Portfolio views are recorded per portfolio, not per asset — the public page
  // carries no per-item request. Report presence, and the account-level count.
  const portfolioViews = await safeRows<{ n: bigint }>(
    'portfolio views',
    `SELECT COUNT(*) AS n FROM platform_events
      WHERE "ownerUserId" = $1 AND "lifecycleType" = 'PORTFOLIO_VIEWED'`,
    owner,
  );
  if (portfolioViews === null) unavailable.push('portfolio views');

  const shares: TrackedShare[] = shareRows.map((r) => ({
    shareLinkId: String(r['id']),
    token: String(r['token']),
    recipient: (r['recipientLabel'] as string | null) || (r['recipientEmail'] as string | null) || null,
    createdAt: new Date(r['createdAt'] as string),
    isActive: Boolean(r['isActive']),
    expiresAt: r['expiresAt'] ? new Date(r['expiresAt'] as string) : null,
    parentLinkId: (r['parentLinkId'] as string | null) ?? null,
    forwardedByLabel: (r['forwardedByLabel'] as string | null) ?? null,
    fromExchange: String(r['sourceContext'] ?? 'hub') !== 'hub',
    views: num(r['views']),
    downloads: num(r['downloads']),
    screenshotAttempts: num(r['screenshot_attempts']),
    viewers: num(r['viewers']),
    lastSeenAt: r['last_seen'] ? new Date(r['last_seen'] as string) : null,
    country: (r['country'] as string | null) ?? null,
  }));

  const checkRow = (lifecycleChecks ?? [])[0];

  return {
    asset: {
      assetId: asset.id,
      filename: asset.originalFilename,
      assetType: String(asset.assetType),
      status: String(asset.status),
      mimeType: asset.mimeType,
      sizeBytes: asset.sizeBytes,
      protectedAt: asset.createdAt,
      monitorStatus: asset.monitorStatus,
    },
    certificate: certificate
      ? {
          certificateId: certificate.certificateId,
          status: String(certificate.status),
          issuedAt: certificate.issuedAt,
          expiresAt: certificate.expiresAt,
          revokedAt: certificate.revokedAt,
          checks: lifecycleChecks === null ? null : num(checkRow?.n),
          lastCheckedAt: checkRow?.last_at ? new Date(checkRow.last_at) : null,
        }
      : null,
    shares,
    purchases: (purchases ?? []).map((p) => ({
      orderId: (p['order_id'] as string | null) ?? null,
      sealId: (p['seal_id'] as string | null) ?? null,
      buyerPinitId: (p['buyer_pinit_id'] as string | null) ?? null,
      licenseTier: (p['license_tier'] as string | null) ?? null,
      licenseStatus: (p['license_status'] as string | null) ?? null,
      deliveryStatus: (p['delivery_status'] as string | null) ?? null,
      sealedAt: p['sealed_at'] ? new Date(p['sealed_at'] as string) : null,
      deliveryExpiresAt: p['delivery_expires_at'] ? new Date(p['delivery_expires_at'] as string) : null,
    })),
    portfolio: {
      shown: Boolean(portfolio),
      views: portfolioViews === null ? null : num((portfolioViews[0] ?? {}).n),
    },
    monitoring: {
      status: asset.monitorStatus,
      foundOnline: asset.discoveriesCount,
      lastDiscoveryAt: asset.lastDiscoveryAt,
    },
    evidence: { records: evidence[0], investigations: evidence[1] },
    unavailable,
  };
}
