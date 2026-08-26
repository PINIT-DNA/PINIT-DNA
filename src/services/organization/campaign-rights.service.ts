/**
 * Rights for the assets in a campaign.
 *
 * This creates no licensing model. Exchange owns licences, and is read here
 * through the `exchange` schema on the same Postgres instance, read-only, the
 * same way asset-360 already does it. If Exchange is unreachable or an asset
 * was never listed, the Hub-side facts still render and the licence section
 * says plainly that there is no licence on record — inventing a default would
 * be worse than an empty state, because someone would act on it.
 *
 * Privacy: buyer name, email and organisation exist in exchange.orders_sealed
 * and are deliberately not selected. The team may see that an asset is
 * licensed, to which PINIT ID, and on what terms — not the buyer's contact
 * details. This mirrors the projection-level contract in asset-360.
 */
import { prisma } from '../../lib/prisma';
import { logger } from '../../lib/logger';
import { AppError } from '../../api/middleware/error.middleware';
import { requireOrgRole } from './org-access.service';
import { OrganizationMemberRole } from './constants/org-rbac';

/**
 * Exchange may not be migrated in every environment; never fail the page for it.
 *
 * Returns whether it answered as well as what it returned, because "no licences"
 * and "we could not ask" are different facts and must not both render as an
 * empty state — someone would read the second as the first.
 */
async function safeQuery<T>(
  label: string, sql: string, ...params: unknown[]
): Promise<{ rows: T[]; ok: boolean }> {
  try {
    return { rows: await prisma.$queryRawUnsafe<T[]>(sql, ...params), ok: true };
  } catch (err) {
    logger.warn(`[CampaignRights] ${label} unavailable`, { error: String(err) });
    return { rows: [], ok: false };
  }
}

interface ListingRow {
  listing_id: string; asset_id: string; status: string | null;
  price_personal: unknown; price_commercial: unknown;
  price_exclusive: unknown; price_enterprise: unknown;
  ai_training_opt_out: boolean | null; created_at: Date | null;
}

interface OrderRow {
  asset_id: string; license_tier: string | null; license_status: string | null;
  license_expires_at: Date | null; license_terms_version: string | null;
  terms_accepted_at: Date | null; buyer_pinit_id: string | null;
  sealed_at: Date | null; download_limit: number | null; download_count: number | null;
}

/**
 * What a tier permits, stated in words rather than left as a code.
 *
 * These are descriptions of Exchange's existing tiers, not a new policy — the
 * team should not have to know what "enterprise" means to answer a client.
 */
const TIER_TERMS: Record<string, { label: string; commercial: boolean; summary: string }> = {
  personal:   { label: 'Personal',   commercial: false, summary: 'Personal, non-commercial use only.' },
  commercial: { label: 'Commercial', commercial: true,  summary: 'Commercial use permitted, non-exclusive.' },
  exclusive:  { label: 'Exclusive',  commercial: true,  summary: 'Commercial use, exclusive to the licensee.' },
  enterprise: { label: 'Enterprise', commercial: true,  summary: 'Commercial use across an organisation.' },
};

/**
 * The state a person actually needs, derived from the licence facts.
 *
 * Kept separate from `state` (none/listed/licensed), which describes where the
 * asset is on Exchange. This describes what the rights *mean right now* — an
 * expired licence is still "licensed" on Exchange but confers nothing today.
 */
export type RightsState =
  | 'NONE'          // nothing on record
  | 'AVAILABLE'     // listed, not yet licensed
  | 'ACTIVE'        // licensed and in force
  | 'EXPIRING'      // in force, but within 30 days of expiry
  | 'EXPIRED'       // past its expiry
  | 'RESTRICTED'    // in force but carrying restrictions worth surfacing
  | 'UNKNOWN';      // Exchange could not be reached — not the same as "none"

const EXPIRING_WINDOW_DAYS = 30;

function deriveRightsState(input: {
  hasOrder: boolean;
  hasListing: boolean;
  exchangeReachable: boolean;
  licenseStatus: string | null;
  expiresAt: Date | null;
  restrictions: string[];
}): RightsState {
  // "We could not ask" must never render as "there are none".
  if (!input.exchangeReachable) return 'UNKNOWN';
  if (!input.hasOrder) return input.hasListing ? 'AVAILABLE' : 'NONE';

  if (input.expiresAt) {
    const msLeft = input.expiresAt.getTime() - Date.now();
    if (msLeft <= 0) return 'EXPIRED';
    if (msLeft <= EXPIRING_WINDOW_DAYS * 86_400_000) return 'EXPIRING';
  }
  if ((input.licenseStatus ?? '').toLowerCase() === 'expired') return 'EXPIRED';
  if ((input.licenseStatus ?? '').toLowerCase() === 'revoked') return 'EXPIRED';

  return input.restrictions.length > 0 ? 'RESTRICTED' : 'ACTIVE';
}

function describeTier(tier: string | null) {
  if (!tier) return null;
  return TIER_TERMS[tier.toLowerCase()] ?? {
    label: tier, commercial: false,
    summary: 'Terms are recorded on the Exchange licence.',
  };
}

export const campaignRightsService = {
  /**
   * Rights and protection for every asset in a campaign.
   *
   * Three sources, kept distinct rather than merged, because they answer
   * different questions and have different authorities:
   *   protection — Hub. Does this asset have a DNA record, vault entry, certificate.
   *   licence    — Exchange. Has it been listed or licensed, on what terms.
   *   access     — Hub. Who can currently reach it, and how.
   */
  async listForCampaign(organizationId: string, actorUserId: string, campaignId: string) {
    await requireOrgRole(actorUserId, organizationId, OrganizationMemberRole.VIEWER);

    const campaign = await prisma.campaign.findFirst({
      where: { id: campaignId, organizationId },
      select: { id: true, name: true,
                client: { select: { id: true, name: true, contactName: true } } },
    });
    if (!campaign) throw new AppError(404, 'Campaign not found');

    const assets = await prisma.asset.findMany({
      where: { campaignId },
      orderBy: { createdAt: 'desc' },
      select: {
        id: true, originalFilename: true, assetType: true, mimeType: true,
        dnaId: true, vaultId: true, certificateId: true, ownerUserId: true,
        createdAt: true,
      },
    });
    if (assets.length === 0) {
      return {
        campaignName: campaign.name,
        clientName: campaign.client?.name ?? null,
        clientContact: campaign.client?.contactName ?? null,
        exchangeReachable: true,
        assets: [],
      };
    }

    const assetIds = assets.map((a) => a.id);

    const [certs, versions, memberAssets, listingsRes, ordersRes, owners] = await Promise.all([
      // Match on assetId OR vaultId: Certificate.assetId post-dates most existing
      // certificates, so an assetId-only lookup reports "no certificate" for an
      // asset that plainly has one.
      prisma.certificate.findMany({
        where: {
          OR: [
            { assetId: { in: assetIds } },
            { vaultId: { in: assets.map((a) => a.vaultId).filter((v): v is string => Boolean(v)) } },
          ],
        },
        select: { assetId: true, vaultId: true, certificateId: true, status: true,
                  issuedAt: true, expiresAt: true },
      }),
      prisma.assetVersion.findMany({
        where: { assetId: { in: assetIds } },
        select: { assetId: true, versionNumber: true, reviewStatus: true, supersededAt: true },
      }),
      prisma.campaignMemberAsset.findMany({
        where: { assetId: { in: assetIds } },
        select: {
          assetId: true,
          member: { select: { name: true, isExternal: true, accessStatus: true } },
        },
      }),
      // Exchange — read-only, and only the columns the team is entitled to see.
      safeQuery<ListingRow>('listings',
        `SELECT listing_id, asset_id, status, price_personal, price_commercial,
                price_exclusive, price_enterprise, ai_training_opt_out, created_at
           FROM exchange.listings WHERE asset_id = ANY($1::text[])`, assetIds),
      safeQuery<OrderRow>('orders',
        `SELECT asset_id, license_tier, license_status, license_expires_at,
                license_terms_version, terms_accepted_at, buyer_pinit_id,
                sealed_at, download_limit, download_count
           FROM exchange.orders_sealed WHERE asset_id = ANY($1::text[])
          ORDER BY sealed_at DESC`, assetIds),
      prisma.user.findMany({
        where: { id: { in: [...new Set(assets.map((a) => a.ownerUserId))] } },
        select: { id: true, fullName: true, shortId: true },
      }),
    ]);

    // Index by both keys so either linkage resolves.
    const certByAsset = new Map<string, (typeof certs)[number]>();
    for (const c of certs) {
      if (c.assetId) certByAsset.set(c.assetId, c);
    }
    const certByVault = new Map(certs.map((c) => [c.vaultId, c]));
    const ownerById = new Map(owners.map((o) => [o.id, o]));

    const versionsByAsset = new Map<string, typeof versions>();
    for (const v of versions) {
      const list = versionsByAsset.get(v.assetId) ?? [];
      list.push(v);
      versionsByAsset.set(v.assetId, list);
    }

    const accessByAsset = new Map<string, Array<{ name: string; kind: string; status: string }>>();
    for (const ma of memberAssets) {
      const list = accessByAsset.get(ma.assetId) ?? [];
      list.push({
        name: ma.member.name ?? 'Unnamed',
        kind: ma.member.isExternal ? 'external creator' : 'team',
        status: ma.member.accessStatus,
      });
      accessByAsset.set(ma.assetId, list);
    }

    const listings = listingsRes.rows;
    const orders = ordersRes.rows;
    // Reachable if either query answered — one table being empty is not a failure.
    const exchangeOk = listingsRes.ok && ordersRes.ok;

    const listingByAsset = new Map(listings.map((l) => [l.asset_id, l]));
    const ordersByAsset = new Map<string, OrderRow[]>();
    for (const o of orders) {
      const list = ordersByAsset.get(o.asset_id) ?? [];
      list.push(o);
      ordersByAsset.set(o.asset_id, list);
    }

    return {
      campaignName: campaign.name,
      clientName: campaign.client?.name ?? null,
      clientContact: campaign.client?.contactName ?? null,
      /** True when the Exchange schema answered at all — lets the UI distinguish
       *  "no licence" from "we could not ask". */
      exchangeReachable: exchangeOk,
      assets: assets.map((a) => {
        const cert = certByAsset.get(a.id) ?? (a.vaultId ? certByVault.get(a.vaultId) : undefined);
        const chain = versionsByAsset.get(a.id) ?? [];
        const current = chain.find((v) => !v.supersededAt) ?? chain[0] ?? null;
        const listing = listingByAsset.get(a.id);
        const assetOrders = ordersByAsset.get(a.id) ?? [];
        const live = assetOrders.find((o) => (o.license_status ?? '').toLowerCase() === 'active')
          ?? assetOrders[0] ?? null;
        const tier = describeTier(live?.license_tier ?? null);
        const owner = ownerById.get(a.ownerUserId);

        const restrictions = [
          listing?.ai_training_opt_out ? 'Excluded from AI training' : null,
          live?.download_limit ? `Download limit ${live.download_limit}` : null,
          live && tier && !tier.commercial ? 'No commercial use' : null,
        ].filter((r): r is string => Boolean(r));

        const exchangeReachable = exchangeOk;
        const rightsState = deriveRightsState({
          hasOrder: Boolean(live),
          hasListing: Boolean(listing),
          exchangeReachable,
          licenseStatus: live?.license_status ?? null,
          expiresAt: live?.license_expires_at ?? null,
          restrictions,
        });

        return {
          assetId: a.id,
          filename: a.originalFilename,
          assetType: a.assetType,
          addedAt: a.createdAt.toISOString(),

          protection: {
            hasDna: Boolean(a.dnaId),
            hasVault: Boolean(a.vaultId),
            certificateId: cert?.certificateId ?? null,
            certificateStatus: cert?.status ?? null,
            certificateIssuedAt: cert?.issuedAt ? cert.issuedAt.toISOString() : null,
            certificateExpiresAt: cert?.expiresAt ? cert.expiresAt.toISOString() : null,
          },

          review: {
            currentVersion: current?.versionNumber ?? null,
            reviewStatus: current?.reviewStatus ?? null,
            versionCount: chain.length,
          },

          /** The creator/owner of record on the Hub side. */
          owner: {
            name: owner?.fullName ?? null,
            pinitId: owner?.shortId ?? null,
          },

          /** What the rights mean right now — see deriveRightsState. */
          rightsState,

          licence: live
            ? {
                state: 'licensed' as const,
                tier: tier?.label ?? live.license_tier,
                commercialUse: tier?.commercial ?? null,
                permittedUse: tier?.summary ?? null,
                status: live.license_status,
                expiresAt: live.license_expires_at ? live.license_expires_at.toISOString() : null,
                licensedTo: live.buyer_pinit_id,
                licensedAt: live.sealed_at ? live.sealed_at.toISOString() : null,
                termsVersion: live.license_terms_version,
                termsAcceptedAt: live.terms_accepted_at ? live.terms_accepted_at.toISOString() : null,
                downloadLimit: live.download_limit,
                downloadCount: live.download_count,
                restrictions,
              }
            : listing
              ? {
                  state: 'listed' as const,
                  tier: null, commercialUse: null,
                  permittedUse: 'Listed on Exchange. No licence has been issued yet.',
                  status: listing.status,
                  expiresAt: null, licensedTo: null, licensedAt: null,
                  termsVersion: null, termsAcceptedAt: null,
                  downloadLimit: null, downloadCount: null,
                  restrictions: listing.ai_training_opt_out ? ['Excluded from AI training'] : [],
                }
              : {
                  state: 'none' as const,
                  tier: null, commercialUse: null,
                  permittedUse: null, status: null,
                  expiresAt: null, licensedTo: null, licensedAt: null,
                  termsVersion: null, termsAcceptedAt: null,
                  downloadLimit: null, downloadCount: null,
                  restrictions: [],
                },

          access: accessByAsset.get(a.id) ?? [],
        };
      }),
    };
  },
};
