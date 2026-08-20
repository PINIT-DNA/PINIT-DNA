/**
 * Asset 360 (Phase 3) — the creator-facing view of one asset's whole life.
 *
 * Reads Hub custody/provenance data through Prisma and Exchange commerce data
 * through the `exchange` schema on the same Postgres instance (read-only, never
 * written from here).
 *
 * Authorization is NOT performed here. The caller must already have resolved
 * ownership from the JWT — see `getAssetActivityForOwner`, which takes an
 * ownerUserId derived from `getAuthUserId(req)` and scopes the Asset lookup by
 * it. No client-supplied ownerUserId, userId or PINIT ID is ever trusted.
 *
 * Privacy contract (creator view):
 *   VISIBLE  aggregate views/saves/wishlist/cart, sales, earnings, licence
 *            state, review ratings, buyer PINIT ID, coarse geography
 *            (country/city), provenance and monitoring.
 *   HIDDEN   buyer email / name / organisation, raw IP, precise GPS, device
 *            fingerprints, payment-gateway identifiers, delivery tokens, and
 *            risk/security internals.
 * The hidden fields are excluded at the SQL projection, not filtered after the
 * fact, so they never enter the process.
 */
import { prisma } from '../../lib/prisma';
import { logger } from '../../lib/logger';

/** Exchange commerce rows are read through raw SQL; these shape the results. */
interface ListingRow {
  listing_id: string;
  title: string | null;
  status: string | null;
  vertical: string | null;
  badge_tier: string | null;
  price_personal: number | null;
  price_commercial: number | null;
  price_exclusive: number | null;
  price_enterprise: number | null;
  views: number | null;
  saves: number | null;
  created_at: Date | null;
}

interface OrderRow {
  seal_id: string;
  order_id: string;
  buyer_pinit_id: string | null;
  license_tier: string | null;
  price_paid: number | null;
  platform_fee: number | null;
  creator_net: number | null;
  status: string | null;
  payment_status: string | null;
  license_status: string | null;
  delivery_status: string | null;
  sealed_at: Date | null;
  delivery_issued_at: Date | null;
  delivery_expires_at: Date | null;
}

async function safeQuery<T>(label: string, sql: string, ...params: unknown[]): Promise<T[]> {
  try {
    return await prisma.$queryRawUnsafe<T[]>(sql, ...params);
  } catch (err) {
    // Exchange may be unreachable or not yet migrated; Asset 360 still renders
    // the Hub-side sections rather than failing the whole page.
    logger.warn(`[Asset360] ${label} unavailable`, { error: String(err) });
    return [];
  }
}

function num(v: unknown): number {
  const n = Number(v ?? 0);
  return Number.isFinite(n) ? n : 0;
}

export interface AssetActivityReport {
  overview: Record<string, unknown>;
  performance: Record<string, unknown>;
  marketplace: Record<string, unknown>;
  purchases: Record<string, unknown>;
  earnings: Record<string, unknown>;
  reviews: Record<string, unknown>;
  engagement: Record<string, unknown>;
  licenses: Record<string, unknown>;
  delivery: Record<string, unknown>;
  provenance: Record<string, unknown>;
  monitoring: Record<string, unknown>;
  timeline: Array<Record<string, unknown>>;
}

/**
 * Build the full Asset 360 report for an asset the caller owns.
 *
 * @param assetId canonical Asset.id (never a VaultRecord.id or DnaRecord.id)
 * @param ownerUserId the authenticated user id, from the JWT only
 * @returns null when the asset does not exist OR is not owned by the caller —
 *          the two cases are deliberately indistinguishable to the client.
 */
export async function getAssetActivityForOwner(
  assetId: string,
  ownerUserId: string,
): Promise<AssetActivityReport | null> {
  const id = String(assetId || '').trim();
  const owner = String(ownerUserId || '').trim();
  if (!id || !owner) return null;

  // Ownership is enforced in the query itself: an asset belonging to anyone
  // else simply does not match, and the caller gets the same 404 as a
  // non-existent id.
  const asset = await prisma.asset.findFirst({
    where: { id, ownerUserId: owner },
    select: {
      id: true,
      createdAt: true,
      updatedAt: true,
      status: true,
      assetType: true,
      originalFilename: true,
      mimeType: true,
      sizeBytes: true,
      contentHash: true,
      vaultId: true,
      dnaId: true,
      certificateId: true,
      monitorStatus: true,
      monitorJobId: true,
      riskScore: true,
      riskSeverity: true,
      discoveriesCount: true,
      lastScanAt: true,
      lastDiscoveryAt: true,
      sourcePlatform: true,
      ownerUser: { select: { shortId: true, fullName: true } },
    },
  });
  if (!asset) return null;

  const [
    listings,
    orders,
    earnings,
    refunds,
    reviewAgg,
    reviewRows,
    wishlistAgg,
    cartAgg,
    timeline,
    certificate,
    monitor,
    shareGeo,
    shareAgg,
  ] = await Promise.all([
    safeQuery<ListingRow>(
      'listings',
      `SELECT listing_id, title, status, vertical, badge_tier,
              price_personal, price_commercial, price_exclusive, price_enterprise,
              views, saves, created_at
         FROM exchange.listings WHERE asset_id = $1 ORDER BY created_at DESC`,
      id,
    ),

    // Gateway ids, buyer name/email/org and delivery tokens are not projected.
    safeQuery<OrderRow>(
      'orders',
      `SELECT seal_id, order_id, buyer_pinit_id, license_tier,
              price_paid, platform_fee, creator_net,
              status, payment_status, license_status, delivery_status,
              sealed_at, delivery_issued_at, delivery_expires_at
         FROM exchange.orders_sealed WHERE asset_id = $1 ORDER BY sealed_at DESC`,
      id,
    ),

    safeQuery<Record<string, unknown>>(
      'earnings',
      `SELECT COALESCE(SUM(gross_amount),0) gross,
              COALESCE(SUM(platform_fee),0)  fee,
              COALESCE(SUM(net_amount),0)    net,
              COUNT(*)::int total_rows,
              COUNT(*) FILTER (WHERE status = 'reversed')::int reversed
         FROM exchange.seller_earnings WHERE asset_id = $1`,
      id,
    ),

    safeQuery<Record<string, unknown>>(
      'refunds',
      `SELECT COALESCE(SUM(amount),0) total, COUNT(*)::int count
         FROM exchange.refunds WHERE asset_id = $1`,
      id,
    ),

    safeQuery<Record<string, unknown>>(
      'reviewAgg',
      `SELECT COUNT(*)::int count, COALESCE(AVG(rating),0) avg_rating
         FROM exchange.reviews WHERE asset_id = $1`,
      id,
    ),

    // buyer_name is deliberately excluded; the Pinit ID identifies the reviewer.
    safeQuery<Record<string, unknown>>(
      'reviewRows',
      `SELECT rating, comment, buyer_pinit_id, created_at
         FROM exchange.reviews WHERE asset_id = $1 ORDER BY created_at DESC LIMIT 25`,
      id,
    ),

    // buyer_key is a raw session/identity key — only the count is exposed.
    safeQuery<Record<string, unknown>>(
      'wishlist',
      `SELECT COUNT(*)::int count FROM exchange.wishlist WHERE asset_id = $1`,
      id,
    ),

    safeQuery<Record<string, unknown>>(
      'cart',
      `SELECT COUNT(*)::int count FROM exchange.cart_items WHERE asset_id = $1`,
      id,
    ),

    prisma.assetTimelineEvent.findMany({
      where: { assetId: id },
      orderBy: { createdAt: 'desc' },
      take: 200,
      select: {
        id: true,
        createdAt: true,
        eventType: true,
        title: true,
        detail: true,
        platform: true,
        url: true,
        payload: true,
      },
    }),

    prisma.certificate.findFirst({
      where: asset.vaultId
        ? { OR: [{ assetId: id }, { vaultId: asset.vaultId }] }
        : { assetId: id },
      select: {
        certificateId: true,
        status: true,
        issuedAt: true,
        expiresAt: true,
        revokedAt: true,
      },
    }),

    prisma.monitorRecord.findFirst({
      where: {
        OR: [{ assetId: id }, ...(asset.dnaId ? [{ dnaRecordId: asset.dnaId }] : [])],
      },
      select: {
        status: true,
        scanType: true,
        totalChecks: true,
        totalMatches: true,
        totalFailures: true,
        lastCheckedAt: true,
        nextCheckAt: true,
      },
    }),

    // Coarse geography only — country/city. IP, GPS, fingerprint and risk data
    // are never selected.
    safeQuery<Record<string, unknown>>(
      'shareGeo',
      `SELECT l.country, l.city, COUNT(*)::int count
         FROM share_access_logs l
         JOIN share_links s ON s.id = l."shareLinkId"
        WHERE s."assetId" = $1 AND l.country IS NOT NULL
        GROUP BY l.country, l.city ORDER BY count DESC LIMIT 25`,
      id,
    ),

    safeQuery<Record<string, unknown>>(
      'shareAgg',
      `SELECT COUNT(DISTINCT s.id)::int links,
              COUNT(*) FILTER (WHERE l.action = 'VIEWED')::int views,
              COUNT(*) FILTER (WHERE l.action = 'DOWNLOADED')::int downloads
         FROM share_links s LEFT JOIN share_access_logs l ON l."shareLinkId" = s.id
        WHERE s."assetId" = $1`,
      id,
    ),
  ]);

  const e = earnings[0] ?? {};
  const r = refunds[0] ?? {};
  const rv = reviewAgg[0] ?? {};
  const sa = shareAgg[0] ?? {};

  const listingViews = listings.reduce((a, l) => a + num(l.views), 0);
  const listingSaves = listings.reduce((a, l) => a + num(l.saves), 0);
  const orderCount = orders.length;

  // Real, event-sourced counts from the canonical timeline. These are separate
  // from the Exchange `views`/`saves` columns, which are legacy counters that
  // were seeded at listing creation and are NOT a reliable activity history.
  const timelineCounts: Record<string, number> = {};
  for (const t of timeline) {
    timelineCounts[t.eventType] = (timelineCounts[t.eventType] ?? 0) + 1;
  }

  return {
    overview: {
      assetId: asset.id,
      creator: {
        // shortId IS the public PINIT ID (e.g. PINIT-N29WYF9D). The raw
        // User.id UUID is never exposed here.
        pinitId: asset.ownerUser?.shortId ?? null,
        name: asset.ownerUser?.fullName ?? null,
      },
      status: asset.status,
      assetType: asset.assetType,
      filename: asset.originalFilename,
      mimeType: asset.mimeType,
      sizeBytes: asset.sizeBytes,
      protectedAt: asset.createdAt,
      updatedAt: asset.updatedAt,
      sourcePlatform: asset.sourcePlatform,
    },
    performance: {
      // Legacy marketplace counters, labelled so the UI never presents them as
      // event-sourced history.
      listingCounters: { views: listingViews, saves: listingSaves, seeded: true },
      // Event-sourced truth.
      recordedViews: timelineCounts['VIEWED'] ?? 0,
      recordedShareViews: timelineCounts['SHARE_VIEWED'] ?? 0,
      wishlistCount: num(wishlistAgg[0]?.count),
      cartCount: num(cartAgg[0]?.count),
      conversion: listingViews > 0 ? Number((orderCount / listingViews).toFixed(4)) : null,
    },
    marketplace: {
      listings: listings.map((l) => ({
        listingId: l.listing_id,
        title: l.title,
        status: l.status,
        vertical: l.vertical,
        badgeTier: l.badge_tier,
        prices: {
          personal: l.price_personal,
          commercial: l.price_commercial,
          exclusive: l.price_exclusive,
          enterprise: l.price_enterprise,
        },
        createdAt: l.created_at,
      })),
      // Price history is event-sourced — only real PRICE_CHANGED events, never
      // reconstructed or inferred.
      priceHistory: timeline
        .filter((t) => t.eventType === 'PRICE_CHANGED')
        .map((t) => ({ at: t.createdAt, detail: t.detail, change: t.payload })),
    },
    purchases: {
      count: orderCount,
      orders: orders.map((o) => ({
        sealId: o.seal_id,
        orderId: o.order_id,
        buyerPinitId: o.buyer_pinit_id,
        licenseTier: o.license_tier,
        status: o.status,
        paymentStatus: o.payment_status,
        sealedAt: o.sealed_at,
      })),
    },
    earnings: {
      gross: num(e.gross),
      platformFee: num(e.fee),
      creatorNet: num(e.net),
      reversedRows: num(e.reversed),
      refunds: { total: num(r.total), count: num(r.count) },
      currency: 'INR',
    },
    reviews: {
      count: num(rv.count),
      averageRating: Number(num(rv.avg_rating).toFixed(2)),
      items: reviewRows,
    },
    engagement: {
      wishlist: num(wishlistAgg[0]?.count),
      cart: num(cartAgg[0]?.count),
      wishlistAdded: timelineCounts['WISHLIST_ADDED'] ?? 0,
      wishlistRemoved: timelineCounts['WISHLIST_REMOVED'] ?? 0,
      cartAdded: timelineCounts['CART_ADDED'] ?? 0,
      cartRemoved: timelineCounts['CART_REMOVED'] ?? 0,
    },
    licenses: {
      issued: timelineCounts['LICENSE_CREATED'] ?? 0,
      active: orders.filter((o) => (o.license_status ?? '').toLowerCase() === 'active').length,
      items: orders.map((o) => ({
        sealId: o.seal_id,
        licenseTier: o.license_tier,
        licenseStatus: o.license_status,
        buyerPinitId: o.buyer_pinit_id,
      })),
    },
    delivery: {
      delivered: timelineCounts['DELIVERED'] ?? 0,
      downloads: timelineCounts['DOWNLOADED'] ?? 0,
      shareLinks: num(sa.links),
      shareViews: num(sa.views),
      shareDownloads: num(sa.downloads),
      // Coarse only: country/city. No IP, GPS or device data.
      geography: shareGeo,
      items: orders.map((o) => ({
        sealId: o.seal_id,
        deliveryStatus: o.delivery_status,
        issuedAt: o.delivery_issued_at,
        expiresAt: o.delivery_expires_at,
      })),
    },
    provenance: {
      dnaRecordId: asset.dnaId,
      vaultId: asset.vaultId,
      contentHash: asset.contentHash,
      certificate: certificate
        ? {
            certificateId: certificate.certificateId,
            status: certificate.status,
            issuedAt: certificate.issuedAt,
            expiresAt: certificate.expiresAt,
            revokedAt: certificate.revokedAt,
          }
        : null,
    },
    monitoring: {
      status: asset.monitorStatus,
      jobId: asset.monitorJobId,
      riskScore: asset.riskScore,
      riskSeverity: asset.riskSeverity,
      discoveries: asset.discoveriesCount,
      lastScanAt: asset.lastScanAt,
      lastDiscoveryAt: asset.lastDiscoveryAt,
      record: monitor,
    },
    timeline: timeline.map((t) => ({
      id: t.id,
      at: t.createdAt,
      type: t.eventType,
      title: t.title,
      detail: t.detail,
      platform: t.platform,
      url: t.url,
      payload: t.payload,
    })),
  };
}
