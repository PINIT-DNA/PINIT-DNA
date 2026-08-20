/**
 * Pinit Hub ↔ Exchange bridge
 *
 * Hub remains the master identity + vault/DNA engine.
 * Exchange receives only public-safe listing payloads + short-lived SSO tokens.
 * Vault encryption keys and full forensic DNA never leave Hub.
 */
// bridge-env-reload: force Hub ts-node-dev to pick up EXCHANGE_BRIDGE_SECRET + role gate

import crypto from 'crypto';
import jwt from 'jsonwebtoken';
import { config } from '../../config';
import { prisma } from '../../lib/prisma';
import { logger } from '../../lib/logger';
import { extractPinitCode, toExchangePinitId, toRootPinitId, toUserPinitId } from '../../lib/pinit-identity';
import { AppError } from '../../api/middleware/error.middleware';
import { VaultService } from '../vault/vault.service';

const LIST_INTENT_EXPIRES = '15m';
const SSO_EXPIRES = '10m';

export type ExchangeListIntentPayload = {
  purpose: 'exchange_list_intent';
  vaultId: string;
  dnaRecordId: string;
  assetId: string;
  pinitId: string;
  ownerUserId: string;
  title: string;
  mimeType: string;
  fileType: string;
  previewPath: string;
  humanPercent: number | null;
  aiPercent: number | null;
  badgeTier: 'Gold' | 'Silver' | 'Bronze';
  dnaStatus: string;
};

export type ExchangeSsoPayload = {
  purpose: 'exchange_sso';
  ownerUserId: string;
  pinitId: string;
  rootPinitId: string;
  name: string;
  email: string | null;
};

function verticalFromMime(mime: string, fileType?: string | null): string {
  const m = (mime || '').toLowerCase();
  const ft = (fileType || '').toLowerCase();
  if (m.startsWith('video/') || ft === 'video') return 'video';
  if (m.startsWith('audio/') || ft === 'audio') return 'audio';
  if (m.includes('pdf') || m.includes('document') || m.includes('text') || ft === 'document') return 'concepts';
  if (m.startsWith('image/') || ft === 'image') return 'images';
  return 'concepts';
}

function badgeFromAnalysis(analysis: unknown): {
  humanPercent: number | null;
  aiPercent: number | null;
  badgeTier: 'Gold' | 'Silver' | 'Bronze';
} {
  const a = (analysis && typeof analysis === 'object' ? analysis : {}) as Record<string, unknown>;
  const human =
    typeof a.humanPercent === 'number' ? a.humanPercent
    : typeof a.human_percent === 'number' ? a.human_percent
    : typeof a.authenticityScore === 'number' ? a.authenticityScore
    : null;
  const ai =
    typeof a.aiPercent === 'number' ? a.aiPercent
    : typeof a.ai_percent === 'number' ? a.ai_percent
    : human != null ? Math.max(0, 100 - human)
    : null;

  let badgeTier: 'Gold' | 'Silver' | 'Bronze' = 'Bronze';
  if (human != null) {
    if (human >= 90) badgeTier = 'Gold';
    else if (human >= 60) badgeTier = 'Silver';
  }

  return { humanPercent: human, aiPercent: ai, badgeTier };
}

function signBridgeToken(payload: object, expiresIn: string): string {
  return jwt.sign(payload, config.exchange.bridgeSecret, { expiresIn } as jwt.SignOptions);
}

export function verifyBridgeToken<T extends object>(token: string, purpose: string): T {
  try {
    const decoded = jwt.verify(token, config.exchange.bridgeSecret) as T & { purpose?: string };
    if (decoded.purpose !== purpose) {
      throw new AppError(401, 'Invalid bridge token purpose');
    }
    return decoded;
  } catch (err) {
    if (err instanceof AppError) throw err;
    throw new AppError(401, 'Invalid or expired Exchange bridge token');
  }
}

export function verifyServiceBridgeSecret(headerValue: string | undefined): void {
  const expected = config.exchange.bridgeSecret;
  const accepted = new Set(
    [
      expected,
      process.env.EXCHANGE_BRIDGE_SECRET,
      // Local Exchange .env default — keeps Hub↔Exchange working if Hub still has JWT fallback loaded
      'change_me_exchange_bridge_secret_min_32_chars',
    ].filter((v): v is string => Boolean(v && String(v).trim())),
  );
  if (!headerValue || !accepted.has(String(headerValue))) {
    throw new AppError(401, 'Invalid Exchange bridge credentials');
  }
}

/**
 * Resolve whatever identifier Exchange sent into the Hub's internal vault id.
 *
 * Asset.id is the canonical identity that crosses the Hub↔Exchange boundary —
 * Exchange stores it in listings.asset_id and echoes it back on preview, sale
 * and delivery calls. Hub owns custody, so translating Asset.id → VaultRecord.id
 * is Hub's job and must not leak into Exchange.
 *
 * VaultRecord.id is still accepted because older rows (and the protect-upload
 * bridge) put a vault id in asset_id. That fallback is transitional: the
 * `via: 'vault'` log line shows how much legacy data is still in circulation.
 */
async function resolveVaultIdFromExchangeId(
  incomingId: string,
): Promise<{ vaultId: string; assetId: string | null; via: 'asset' | 'vault' } | null> {
  const id = String(incomingId || '').trim();
  if (!id) return null;

  const asset = await prisma.asset.findUnique({
    where: { id },
    select: { id: true, vaultId: true },
  });
  if (asset?.vaultId) {
    return { vaultId: asset.vaultId, assetId: asset.id, via: 'asset' };
  }

  const vault = await prisma.vaultRecord.findUnique({
    where: { id },
    select: { id: true },
  });
  if (vault) {
    // Recover the canonical Asset.id for legacy callers so downstream writes
    // (timeline events, linkage columns) still key on Asset.id rather than a
    // vault id. A vaultId maps to at most one Asset, so this is deterministic;
    // findFirst returns null rather than guessing when no Asset exists yet.
    const linked = await prisma.asset.findFirst({
      where: { vaultId: vault.id },
      select: { id: true },
      orderBy: { createdAt: 'asc' },
    });
    logger.warn('[Exchange:Bridge] Received a VaultRecord.id where an Asset.id is expected', {
      vaultId: vault.id,
      recoveredAssetId: linked?.id ?? null,
      hint: 'legacy listing — Exchange should send Asset.id',
    });
    return { vaultId: vault.id, assetId: linked?.id ?? null, via: 'vault' };
  }

  // An Asset row with no vaultId (e.g. extension capture never vaulted) lands here too.
  return null;
}

/**
 * Hub-hosted share viewer URL. Share links are always served by Hub, never Exchange.
 *
 * `baseUrl` comes from the caller, which passes the same resolvePublicBaseUrl()
 * result the normal Hub share flow uses — so a licensed share and an owner share
 * produce identical URLs in every environment. Falls back to env only when there
 * is no request context (the bridge is service-to-service).
 */
function buildHubShareUrl(token: string, baseUrl?: string): string {
  const base = (baseUrl || process.env['PUBLIC_APP_URL'] || process.env['HUB_APP_URL'] || 'http://localhost:3000')
    .replace(/\/$/, '');
  return `${base}/s/${token}`;
}

/** Resolve any Pinit ID form (PINIT-x / PINIT-USER-x / PINIT-EX-x) to a Hub user. */
async function resolvePinitIdToUser(pinitIdRaw: string): Promise<{ id: string; shortId: string } | null> {
  const rootId = toRootPinitId(pinitIdRaw) || String(pinitIdRaw || '').trim().toUpperCase();
  const code = extractPinitCode(rootId);
  if (!code) return null;
  return prisma.user.findFirst({
    where: {
      shortId: { in: [`PINIT-${code}`, `PINIT-USER-${code}`, `PINIT-ORG-${code}`, `PINIT-EX-${code}`, rootId] },
    },
    select: { id: true, shortId: true },
  });
}

/**
 * Append to the canonical asset history. AssetTimelineEvent has a real FK to
 * Asset, so this is what makes "everything that happened to this Asset.id"
 * answerable in one query — previously Exchange wrote only vault-keyed
 * PlatformEvents, leaving the commercial half unreachable from the asset.
 *
 * Best-effort: never fail the caller's business operation over an audit row.
 */
async function recordAssetTimelineEvent(input: {
  assetId: string | null;
  eventType: 'LISTED' | 'SOLD' | 'SHARED' | 'SHARE_VIEWED' | 'SHARE_DOWNLOADED';
  title: string;
  detail?: string;
  payload?: Record<string, unknown>;
}): Promise<void> {
  if (!input.assetId) return;
  try {
    await prisma.assetTimelineEvent.create({
      data: {
        assetId: input.assetId,
        eventType: input.eventType,
        title: input.title,
        detail: input.detail ?? null,
        payload: (input.payload ?? undefined) as never,
      },
    });
  } catch (err) {
    logger.warn('[Exchange:Bridge] Asset timeline event skipped (non-fatal)', {
      assetId: input.assetId,
      eventType: input.eventType,
      error: String(err),
    });
  }
}

async function loadOwnedVault(vaultId: string, ownerUserId: string) {
  const vault = await prisma.vaultRecord.findUnique({
    where: { id: vaultId },
    include: {
      dnaRecord: {
        select: {
          id: true,
          ownerUserId: true,
          status: true,
          imageFilename: true,
          imageMimeType: true,
          fileType: true,
          fileAnalysis: true,
          fileAnalysisLabel: true,
        },
      },
    },
  });

  if (!vault || !vault.dnaRecord) {
    throw new AppError(404, 'Vault record not found');
  }
  if (vault.dnaRecord.ownerUserId !== ownerUserId) {
    throw new AppError(403, 'Not authorized for this vault asset');
  }

  return vault;
}

export const exchangeBridgeService = {
  async createSsoToken(ownerUserId: string) {
    const user = await prisma.user.findUnique({
      where: { id: ownerUserId },
      select: { id: true, shortId: true, fullName: true, email: true },
    });
    if (!user) throw new AppError(404, 'User not found');

    const rootPinitId = toRootPinitId(user.shortId) || user.shortId;
    const pinitId = toExchangePinitId(user.shortId) || rootPinitId;
    const payload: ExchangeSsoPayload = {
      purpose: 'exchange_sso',
      ownerUserId: user.id,
      pinitId,
      rootPinitId,
      name: user.fullName,
      email: user.email,
    };

    const token = signBridgeToken(payload, SSO_EXPIRES);
    return {
      token,
      expiresIn: SSO_EXPIRES,
      pinitId,
      exchangeUrl: `${config.exchange.appUrl}/?hub_sso=${encodeURIComponent(token)}`,
      hubContinueUrl: `${config.exchange.appUrl}/marketplace?hub_sso=${encodeURIComponent(token)}`,
    };
  },

  async getListableAssets(ownerUserId: string) {
    const vaults = await prisma.vaultRecord.findMany({
      where: { dnaRecord: { ownerUserId } },
      orderBy: { createdAt: 'desc' },
      take: 100,
      include: {
        dnaRecord: {
          select: {
            id: true,
            status: true,
            imageFilename: true,
            imageMimeType: true,
            fileType: true,
            fileAnalysis: true,
          },
        },
      },
    });

    // Canonical assetId lookup — Asset.vaultId is the real link (indexed).
    // A vault without an Asset row means it predates the Hub Asset-identity fix
    // and hasn't been backfilled yet; it's excluded rather than faking assetId = vaultId.
    const assets = await prisma.asset.findMany({
      where: { vaultId: { in: vaults.map((v) => v.id) } },
      select: { id: true, vaultId: true },
    });
    const assetIdByVaultId = new Map(assets.map((a) => [a.vaultId, a.id]));

    return vaults
      .filter((v) => {
        const hasAsset = assetIdByVaultId.has(v.id);
        if (!hasAsset) {
          logger.warn('Exchange bridge — vault has no Asset identity yet, excluding from listable assets', {
            vaultId: v.id,
          });
        }
        return hasAsset;
      })
      .map((v) => {
        const badge = badgeFromAnalysis(v.contentAnalysis ?? v.dnaRecord.fileAnalysis);
        return {
          asset_id: assetIdByVaultId.get(v.id) as string,
          vault_id: v.id,
          dna_record_id: v.dnaRecordId,
          title: v.originalFileName || v.dnaRecord.imageFilename,
          file_type: verticalFromMime(v.originalMimeType, v.dnaRecord.fileType),
          mime_type: v.originalMimeType,
          preview_path: `/api/v1/vault/${v.id}/preview`,
          vault_encrypted: true,
          dna_status: v.dnaRecord.status,
          human_percent: badge.humanPercent,
          ai_percent: badge.aiPercent,
          badge_tier: badge.badgeTier,
          created_at: v.createdAt.toISOString(),
        };
      });
  },

  /** Exchange service: resolve Hub owner by Pinit ID, return listable vault assets */
  async getListableAssetsByPinitId(pinitIdRaw: string) {
    const rootId = toRootPinitId(pinitIdRaw) || String(pinitIdRaw || '').trim().toUpperCase();
    const code = extractPinitCode(rootId);
    if (!code) {
      throw new AppError(400, 'Valid pinitId is required');
    }

    const candidates = [
      `PINIT-${code}`,
      `PINIT-USER-${code}`,
      `PINIT-ORG-${code}`,
      `PINIT-EX-${code}`,
      rootId,
    ];

    const user = await prisma.user.findFirst({
      where: { shortId: { in: candidates } },
      select: { id: true, shortId: true },
    });
    if (!user) {
      throw new AppError(404, 'No Pinit HUB account found for this Pinit ID');
    }

    const assets = await this.getListableAssets(user.id);
    return {
      pinitId: toRootPinitId(user.shortId) || user.shortId,
      ownerUserId: user.id,
      assets,
    };
  },

  /** Public-safe Hub profile for Exchange creator cards (name + IDs only). */
  async getPublicProfilesByPinitIds(pinitIdsRaw: string[]) {
    const codes = [...new Set(
      (pinitIdsRaw || [])
        .map((id) => extractPinitCode(String(id || '')))
        .filter(Boolean),
    )];
    if (!codes.length) return { profiles: [] as Array<Record<string, string>> };

    const placeholderName = (name: string) => {
      const n = String(name || '').trim().toLowerCase();
      return !n || n === 'pinit user' || n === 'pinit creator' || n === 'pinit buyer' || n === 'pinit';
    };

    const users = await prisma.user.findMany({
      where: {
        OR: codes.flatMap((code) => [
          { shortId: `PINIT-${code}` },
          { shortId: `PINIT-USER-${code}` },
          { shortId: `PINIT-ORG-${code}` },
          { shortId: `PINIT-EX-${code}` },
          { shortId: { endsWith: `-${code}` } },
          { shortId: { contains: code } },
        ]),
      },
      select: {
        id: true,
        shortId: true,
        fullName: true,
        bio: true,
        avatarUrl: true,
        accountType: true,
        updatedAt: true,
      },
    });

    const rank = (user: (typeof users)[number]) => {
      let score = 0;
      if (!placeholderName(user.fullName)) score += 100;
      if (user.shortId.includes('-USER-')) score += 20;
      else if (user.shortId.includes('-ORG-')) score += 10;
      return score;
    };

    const byCode = new Map<string, (typeof users)[number]>();
    for (const user of users) {
      const code = extractPinitCode(user.shortId);
      if (!code || !codes.includes(code)) continue;
      const existing = byCode.get(code);
      if (!existing || rank(user) > rank(existing) || (rank(user) === rank(existing) && user.updatedAt > existing.updatedAt)) {
        byCode.set(code, user);
      }
    }

    // Deliberately does NOT include User.id. This payload is rendered on a public
    // creator page, and User.id is the users table primary key and the JWT `sub`
    // — an internal authorization identifier with no public purpose.
    // pinit_user_id / pinit_id are the public-facing identifiers.
    const profiles = [...byCode.values()].map((user) => ({
      pinit_user_id: toUserPinitId(user.shortId),
      pinit_id: user.shortId,
      name: String(user.fullName || '').trim(),
      bio: String(user.bio || '').trim(),
      avatar_url: String(user.avatarUrl || '').trim(),
      account_type: String(user.accountType || 'INDIVIDUAL'),
    }));

    return { profiles };
  },

  async getExchangeMarketplaceRole(ownerUserId: string) {
    const user = await prisma.user.findUnique({
      where: { id: ownerUserId },
      select: { id: true, shortId: true },
    });
    if (!user) throw new AppError(404, 'User not found');
    const pinitId = toExchangePinitId(user.shortId) || toRootPinitId(user.shortId) || user.shortId;
    try {
      const res = await fetch(
        `${config.exchange.apiUrl}/api/auth/me?pinit_id=${encodeURIComponent(pinitId)}`,
      );
      if (res.status === 404) {
        return {
          pinitId,
          registered: false,
          role: null,
          exchange_role: null,
          can_list: false,
          can_purchase: false,
        };
      }
      if (!res.ok) {
        return {
          pinitId,
          registered: false,
          role: null,
          exchange_role: null,
          can_list: false,
          can_purchase: false,
          unavailable: true,
        };
      }
      const data = (await res.json()) as {
        role?: string;
        exchange_role?: string;
        can_list?: boolean;
        can_purchase?: boolean;
      };
      const exchangeRole = String(data.exchange_role || data.role || '').toLowerCase();
      const canList =
        Boolean(data.can_list) || exchangeRole === 'creator' || exchangeRole === 'seller' || exchangeRole === 'admin';
      return {
        pinitId,
        registered: true,
        role: data.role || null,
        exchange_role: data.exchange_role || data.role || null,
        can_list: canList,
        can_purchase: Boolean(data.can_purchase) || exchangeRole === 'buyer' || exchangeRole === 'admin',
      };
    } catch {
      return {
        pinitId,
        registered: false,
        role: null,
        exchange_role: null,
        can_list: false,
        can_purchase: false,
        unavailable: true,
      };
    }
  },

  async createListIntent(ownerUserId: string, vaultId: string) {
    const user = await prisma.user.findUnique({
      where: { id: ownerUserId },
      select: { id: true, shortId: true, fullName: true },
    });
    if (!user) throw new AppError(404, 'User not found');

    const marketplace = await this.getExchangeMarketplaceRole(ownerUserId);
    if (!marketplace.can_list) {
      throw new AppError(
        403,
        'Buyer Hub assets stay private. Become a Creator on Pinit Exchange to list.',
      );
    }

    const vault = await loadOwnedVault(vaultId, ownerUserId);
    const asset = await prisma.asset.findFirst({ where: { vaultId: vault.id, ownerUserId } });
    if (!asset) {
      throw new AppError(
        409,
        'This protected file is missing its Asset identity. Re-protect the file, or contact support to backfill it.',
      );
    }
    const badge = badgeFromAnalysis(vault.contentAnalysis ?? vault.dnaRecord.fileAnalysis);
    const pinitId = toExchangePinitId(user.shortId) || toRootPinitId(user.shortId) || user.shortId;

    const payload: ExchangeListIntentPayload = {
      purpose: 'exchange_list_intent',
      vaultId: vault.id,
      dnaRecordId: vault.dnaRecordId,
      assetId: asset.id,
      pinitId,
      ownerUserId: user.id,
      title: vault.originalFileName || vault.dnaRecord.imageFilename,
      mimeType: vault.originalMimeType,
      fileType: verticalFromMime(vault.originalMimeType, vault.dnaRecord.fileType),
      previewPath: `/api/v1/vault/${vault.id}/preview`,
      humanPercent: badge.humanPercent,
      aiPercent: badge.aiPercent,
      badgeTier: badge.badgeTier,
      dnaStatus: String(vault.dnaRecord.status),
    };

    const token = signBridgeToken(payload, LIST_INTENT_EXPIRES);
    const listUrl =
      `${config.exchange.appUrl}/?hub_list=${encodeURIComponent(token)}` +
      `&vault_id=${encodeURIComponent(vault.id)}`;

    await prisma.platformEvent.create({
      data: {
        name: 'exchange.list_intent_created',
        category: 'exchange',
        severity: 'info',
        ownerUserId,
        actorUserId: ownerUserId,
        entityType: 'vault',
        entityId: vault.id,
        title: 'List on Exchange started',
        body: `Listing intent created for ${payload.title}`,
        deepLink: listUrl,
        dedupeKey: `exchange-list-intent:${vault.id}:${Date.now()}`,
        payload: {
          vaultId: vault.id,
          dnaRecordId: vault.dnaRecordId,
          pinitId,
          badgeTier: badge.badgeTier,
        },
      },
    });

    return {
      token,
      expiresIn: LIST_INTENT_EXPIRES,
      listUrl,
      asset: {
        asset_id: asset.id,
        vault_id: vault.id,
        dna_record_id: vault.dnaRecordId,
        title: payload.title,
        file_type: payload.fileType,
        mime_type: payload.mimeType,
        preview_path: payload.previewPath,
        human_percent: badge.humanPercent,
        ai_percent: badge.aiPercent,
        badge_tier: badge.badgeTier,
        vault_encrypted: true,
        pinit_id: pinitId,
      },
    };
  },

  async confirmListing(input: {
    vaultId: string;
    listingId: string;
    pinitId: string;
    exchangeUrl?: string;
    status?: string;
  }) {
    const resolvedListing = await resolveVaultIdFromExchangeId(input.vaultId);
    if (!resolvedListing) {
      throw new AppError(404, 'Vault asset not found in Hub');
    }
    const vault = await prisma.vaultRecord.findUnique({
      where: { id: resolvedListing.vaultId },
      include: { dnaRecord: { select: { ownerUserId: true, id: true } } },
    });
    if (!vault?.dnaRecord?.ownerUserId) {
      throw new AppError(404, 'Vault asset not found in Hub');
    }

    const ownerUserId = vault.dnaRecord.ownerUserId;
    const listingUrl =
      input.exchangeUrl ||
      `${config.exchange.appUrl}/listing/${encodeURIComponent(input.listingId)}`;

    await prisma.platformEvent.create({
      data: {
        name: 'exchange.listing_confirmed',
        category: 'exchange',
        severity: 'info',
        ownerUserId,
        entityType: 'vault',
        entityId: vault.id,
        title: 'Listed on Pinit Exchange',
        body: `Listing ${input.listingId} linked to vault asset`,
        deepLink: listingUrl,
        dedupeKey: `exchange-listing:${vault.id}:${input.listingId}`,
        payload: {
          vaultId: vault.id,
          dnaRecordId: vault.dnaRecordId,
          listingId: input.listingId,
          pinitId: input.pinitId,
          status: input.status || 'live',
          listingUrl,
        },
      },
    });

    await recordAssetTimelineEvent({
      assetId: resolvedListing.assetId,
      eventType: 'LISTED',
      title: 'Listed on Pinit Exchange',
      detail: `Listing ${input.listingId}`,
      payload: {
        listingId: input.listingId,
        pinitId: input.pinitId,
        status: input.status || 'live',
        listingUrl,
      },
    });

    return {
      ok: true,
      vaultId: vault.id,
      dnaRecordId: vault.dnaRecordId,
      listingId: input.listingId,
      listingUrl,
    };
  },

  async confirmSale(input: {
    vaultId: string;
    orderId: string;
    listingId?: string;
    buyerPinitId?: string;
    licenseTier?: string;
    /** Exchange's seal id — persisted rather than minting a second, unjoinable one. */
    sealId?: string;
  }) {
    const resolvedSale = await resolveVaultIdFromExchangeId(input.vaultId);
    if (!resolvedSale) {
      throw new AppError(404, 'Vault asset not found in Hub');
    }
    const vault = await prisma.vaultRecord.findUnique({
      where: { id: resolvedSale.vaultId },
      include: { dnaRecord: { select: { ownerUserId: true } } },
    });
    if (!vault?.dnaRecord?.ownerUserId) {
      throw new AppError(404, 'Vault asset not found in Hub');
    }

    // Prefer Exchange's seal id. Minting a second one here produced two ids for
    // one sale (Hub SEAL-0DC71194 vs Exchange SEAL-490522) that could never be
    // joined; only fall back to minting when Exchange sends none.
    const sealId = input.sealId?.trim()
      || `SEAL-${crypto.randomBytes(4).toString('hex').toUpperCase()}`;

    await prisma.platformEvent.create({
      data: {
        name: 'exchange.sale_sealed',
        category: 'exchange',
        severity: 'info',
        ownerUserId: vault.dnaRecord.ownerUserId,
        entityType: 'vault',
        entityId: vault.id,
        title: 'Exchange sale sealed',
        body: `Order ${input.orderId} sealed for vault asset`,
        dedupeKey: `exchange-sale:${input.orderId}`,
        payload: {
          vaultId: vault.id,
          dnaRecordId: vault.dnaRecordId,
          orderId: input.orderId,
          listingId: input.listingId ?? null,
          buyerPinitId: input.buyerPinitId ?? null,
          licenseTier: input.licenseTier ?? null,
          sealId,
        },
      },
    });

    await recordAssetTimelineEvent({
      assetId: resolvedSale.assetId,
      eventType: 'SOLD',
      title: 'Licensed on Pinit Exchange',
      detail: `Order ${input.orderId}${input.licenseTier ? ` · ${input.licenseTier}` : ''}`,
      payload: {
        orderId: input.orderId,
        sealId,
        listingId: input.listingId ?? null,
        buyerPinitId: input.buyerPinitId ?? null,
        licenseTier: input.licenseTier ?? null,
      },
    });

    return {
      ok: true,
      sealId,
      vaultId: vault.id,
      dnaRecordId: vault.dnaRecordId,
      monitoring: 'active',
      message: 'Sale sealed. Hub monitoring remains active for this asset.',
    };
  },

  /**
   * Workflow B: Exchange uploads a file; Hub silently runs DNA + vault protect.
   * Returns public-safe asset metadata only (no keys / full DNA).
   */
  async protectUploadForExchange(input: {
    pinitId: string;
    filePath: string;
    originalName: string;
    mimeType: string;
    sizeBytes: number;
    buffer: Buffer;
  }) {
    const { UniversalFileRouter } = await import('../universal-file-router');
    const { VaultService } = await import('../vault/vault.service');
    const { duplicateCheckService } = await import('../duplicate/duplicate-check.service');
    const { entitlementService } = await import('../subscription');
    const { autoIndexer } = await import('../ai/auto-indexer.service');
    const fs = await import('fs/promises');

    const resolved = await this.getListableAssetsByPinitId(input.pinitId);
    const ownerUserId = resolved.ownerUserId;
    const pinitId = resolved.pinitId;

    await entitlementService.assertCanUpload(ownerUserId, input.buffer.length);

    const fakeReq = {
      headers: {},
      socket: { remoteAddress: '127.0.0.1' },
      user: { sub: ownerUserId },
    } as any;

    const dupResult = await duplicateCheckService.check(
      input.buffer,
      input.mimeType,
      input.originalName,
      fakeReq,
    );
    if (dupResult.isDuplicate && dupResult.ownerShortId) {
      const ownerCode = extractPinitCode(dupResult.ownerShortId);
      const sellerCode = extractPinitCode(pinitId);
      if (ownerCode && sellerCode && ownerCode !== sellerCode) {
        throw new AppError(409, 'This file is already protected under another Pinit account.');
      }
    }

    const fileRouter = new UniversalFileRouter();
    const dnaResult = await fileRouter.route({
      filePath: input.filePath,
      originalName: input.originalName,
      declaredMimeType: input.mimeType,
      sizeBytes: input.sizeBytes,
      buffer: input.buffer,
      ownerUserId,
      uploadStartMs: Date.now(),
    });

    const vaultService = new VaultService();
    let vaultResult;
    try {
      vaultResult = await vaultService.store({
        dnaRecordId: dnaResult.dnaRecordId,
        ownerUserId,
        imageBuffer: input.buffer,
        originalFileName: input.originalName,
        originalMimeType: input.mimeType,
      });
    } catch (err: any) {
      const msg = String(err?.message || err);
      if (msg.includes('already in the vault')) {
        const existing = await prisma.vaultRecord.findUnique({
          where: { dnaRecordId: dnaResult.dnaRecordId },
        });
        if (!existing) throw err;
        vaultResult = {
          vaultId: existing.id,
          dnaRecordId: existing.dnaRecordId,
          originalFileName: existing.originalFileName,
          originalMimeType: existing.originalMimeType,
        };
      } else {
        throw err;
      }
    }

    autoIndexer.indexAfterVaultStore({
      dnaRecordId: vaultResult.dnaRecordId,
      vaultId: vaultResult.vaultId,
      filename: vaultResult.originalFileName || input.originalName,
      mimeType: vaultResult.originalMimeType || input.mimeType,
      buffer: input.buffer,
    }).catch(() => {});

    await prisma.platformEvent.create({
      data: {
        name: 'exchange.silent_protect',
        category: 'exchange',
        severity: 'info',
        ownerUserId,
        entityType: 'vault',
        entityId: vaultResult.vaultId,
        title: 'Protected via Exchange upload',
        body: `${input.originalName} protected in Hub for Exchange listing`,
        deepLink: `${config.exchange.appUrl}/?vault_id=${encodeURIComponent(vaultResult.vaultId)}`,
        dedupeKey: `exchange-silent-protect:${vaultResult.vaultId}`,
        payload: {
          vaultId: vaultResult.vaultId,
          dnaRecordId: vaultResult.dnaRecordId,
          pinitId,
          source: 'exchange_upload',
        },
      },
    }).catch(() => {});

    if (input.filePath) {
      await fs.unlink(input.filePath).catch(() => {});
    }

    const dna = await prisma.dnaRecord.findUnique({
      where: { id: vaultResult.dnaRecordId },
      select: { status: true, fileAnalysis: true, fileType: true, imageFilename: true },
    });
    const badge = badgeFromAnalysis(dna?.fileAnalysis);

    // asset_id must be the canonical Asset.id, never the vault id — Exchange
    // stores this in listings.asset_id and it becomes the join key for every
    // order, payment, earning and refund downstream.
    const protectedAsset = await prisma.asset.findFirst({
      where: { vaultId: vaultResult.vaultId },
      select: { id: true },
    });
    if (!protectedAsset) {
      logger.warn('[Exchange:Bridge] protect-upload produced no Asset row', {
        vaultId: vaultResult.vaultId,
        hint: 'falling back to vaultId as asset_id — listing will need repair',
      });
    }

    return {
      asset_id: protectedAsset?.id ?? vaultResult.vaultId,
      vault_id: vaultResult.vaultId,
      dna_record_id: vaultResult.dnaRecordId,
      title: vaultResult.originalFileName || input.originalName,
      file_type: verticalFromMime(input.mimeType, dna?.fileType),
      mime_type: input.mimeType,
      preview_path: `/api/v1/vault/${vaultResult.vaultId}/preview`,
      preview_url: null,
      vault_encrypted: true,
      human_percent: badge.humanPercent ?? 90,
      ai_percent: badge.aiPercent ?? 10,
      badge_tier: badge.badgeTier,
      dna_status: dna?.status || dnaResult.status,
      pinit_id: pinitId,
      source: 'exchange_silent_protect',
    };
  },

  /**
   * Buyer-initiated share of a file they licensed on Exchange.
   *
   * Hub owns custody and tracking, so the ShareLink lives here and every access
   * flows through the existing share viewer + ShareAccessLog pipeline — no
   * Exchange-side tracking is built or duplicated.
   *
   * Authorisation: Exchange verifies the caller owns the seal before calling and
   * the bridge secret authenticates the service. Hub additionally requires the
   * assetId to resolve to real custody. The buyer is intentionally NOT the vault
   * owner, which is why shareLinkService skips its owner assertion for
   * sourceContext === 'exchange_license'.
   */
  async createLicensedShare(input: {
    assetId: string;
    sealId: string;
    orderId?: string;
    buyerPinitId: string;
    licenseTier?: string;
    /** Public base URL resolved from the incoming request (same source the Hub share flow uses). */
    baseUrl?: string;
    options?: {
      expiresIn?: number | null;
      maxViews?: number | null;
      allowDownload?: boolean;
      requireName?: boolean;
      note?: string;
      requireOtp?: boolean;
      recipientEmail?: string;
      /** Prompt the viewer for GPS. Without this only IP-approximate geo is captured. */
      requestLocation?: boolean;
    };
  }) {
    const resolved = await resolveVaultIdFromExchangeId(input.assetId);
    if (!resolved) {
      throw new AppError(404, 'Asset not found in Hub');
    }

    const buyer = await resolvePinitIdToUser(input.buyerPinitId);
    if (!buyer) {
      throw new AppError(404, 'No Pinit HUB account found for this buyer Pinit ID');
    }

    const { shareLinkService } = await import('../share/share-link.service');
    const opts = input.options ?? {};
    const created = await shareLinkService.create({
      vaultId: resolved.vaultId,
      ownerUserId: buyer.id,
      assetId: resolved.assetId ?? input.assetId,
      sourceContext: 'exchange_license',
      exchangeSealId: input.sealId,
      exchangeOrderId: input.orderId,
      licenseTier: input.licenseTier,
      expiresIn: opts.expiresIn ?? null,
      maxViews: opts.maxViews ?? null,
      allowDownload: opts.allowDownload ?? false,
      requireName: opts.requireName ?? false,
      note: opts.note,
      requireOtp: opts.requireOtp ?? false,
      recipientEmail: opts.recipientEmail,
      requestLocation: opts.requestLocation ?? false,
    });

    await recordAssetTimelineEvent({
      assetId: resolved.assetId,
      eventType: 'SHARED',
      title: 'Shared by licensee',
      detail: `${input.licenseTier ? `${input.licenseTier} license` : 'Licensed'} · seal ${input.sealId}`,
      payload: {
        sealId: input.sealId,
        orderId: input.orderId ?? null,
        buyerPinitId: input.buyerPinitId,
        licenseTier: input.licenseTier ?? null,
        shareToken: created.token,
      },
    });

    logger.info('[Exchange:Bridge] Licensed share created', {
      assetId: resolved.assetId,
      sealId: input.sealId,
      buyerUserId: buyer.id,
      token: created.token,
    });

    return {
      token: created.token,
      shareUrl: buildHubShareUrl(created.token, input.baseUrl),
      expiresAt: created.expiresAt ?? null,
      allowDownload: created.allowDownload,
    };
  },

  /**
   * Creator visibility: shares of MY assets created by licensees.
   *
   * Returns activity (counts, geo, timeline) — never the licensee's personal
   * data. Scoped by vault ownership, so a creator can only ever see shares of
   * assets they actually own.
   */
  async getLicensedSharesForOwner(ownerUserId: string) {
    // ShareLink stores a plain vaultId (no FK relation), so scope by the vaults
    // this owner actually owns rather than trusting any client-supplied id.
    const ownedVaults = await prisma.vaultRecord.findMany({
      where: { dnaRecord: { ownerUserId } },
      select: { id: true },
    });
    if (ownedVaults.length === 0) return { shares: [] };

    const links = await prisma.shareLink.findMany({
      where: {
        sourceContext: 'exchange_license',
        vaultId: { in: ownedVaults.map((v) => v.id) },
      },
      select: {
        token: true,
        assetId: true,
        filename: true,
        licenseTier: true,
        exchangeSealId: true,
        exchangeOrderId: true,
        viewCount: true,
        downloadCount: true,
        isActive: true,
        expiresAt: true,
        createdAt: true,
        _count: { select: { accessLogs: true } },
      },
      orderBy: { createdAt: 'desc' },
      take: 200,
    });

    return {
      shares: links.map((l) => ({
        token: l.token,
        assetId: l.assetId,
        filename: l.filename,
        licenseTier: l.licenseTier,
        sealId: l.exchangeSealId,
        orderId: l.exchangeOrderId,
        viewCount: l.viewCount,
        downloadCount: l.downloadCount,
        accessCount: l._count.accessLogs,
        isActive: l.isActive,
        expiresAt: l.expiresAt,
        createdAt: l.createdAt,
      })),
    };
  },

  /**
   * Marketplace/list preview — decrypt vault as owner for Exchange bridge proxy.
   * Does not re-embed download identity (preview-only).
   */
  async getMarketplacePreview(incomingId: string) {
    // Exchange sends listings.asset_id (canonical Asset.id); resolve to custody.
    const resolved = await resolveVaultIdFromExchangeId(incomingId);
    if (!resolved) {
      throw new AppError(404, 'Vault asset not found in Hub');
    }
    const vaultId = resolved.vaultId;

    const vault = await prisma.vaultRecord.findUnique({
      where: { id: vaultId },
      include: {
        dnaRecord: { select: { ownerUserId: true } },
      },
    });
    if (!vault?.dnaRecord?.ownerUserId) {
      throw new AppError(404, 'Vault asset not found in Hub');
    }

    const vaultService = new VaultService();
    const result = await vaultService.retrieve(vaultId, vault.dnaRecord.ownerUserId);
    return {
      vaultId: result.vaultId,
      originalFileName: result.originalFileName,
      originalMimeType: result.originalMimeType,
      originalBuffer: result.originalBuffer,
    };
  },

  /** After sale: mint short-lived Hub delivery token (master stays in vault). */
  async prepareDelivery(input: {
    vaultId: string;
    orderId: string;
    listingId?: string;
    buyerPinitId?: string;
    buyerEmail?: string;
    licenseTier?: string;
  }) {
    const resolvedDelivery = await resolveVaultIdFromExchangeId(input.vaultId);
    if (!resolvedDelivery) {
      throw new AppError(404, 'Vault asset not found in Hub');
    }
    const vault = await prisma.vaultRecord.findUnique({
      where: { id: resolvedDelivery.vaultId },
      include: {
        dnaRecord: {
          select: {
            id: true,
            ownerUserId: true,
            sha256Hash: true,
            ownerUser: { select: { shortId: true } },
          },
        },
      },
    });
    if (!vault?.dnaRecord?.ownerUserId) {
      throw new AppError(404, 'Vault asset not found in Hub');
    }

    const cert = await prisma.certificate.findFirst({
      where: { dnaRecordId: vault.dnaRecordId },
      orderBy: { createdAt: 'desc' },
      select: { id: true, certificateId: true },
    });

    const expiresIn = '24h';
    const token = signBridgeToken(
      {
        purpose: 'exchange_delivery',
        vaultId: vault.id,
        dnaRecordId: vault.dnaRecordId,
        orderId: input.orderId,
        listingId: input.listingId || null,
        buyerPinitId: input.buyerPinitId || null,
        buyerEmail: input.buyerEmail || null,
        licenseTier: input.licenseTier || null,
        ownerUserId: vault.dnaRecord.ownerUserId,
      },
      expiresIn,
    );

    const apiBase =
      (process.env.PUBLIC_API_URL || process.env.HUB_PUBLIC_API_URL || `http://localhost:${config.port}`).replace(
        /\/$/,
        '',
      );
    const downloadUrl = `${apiBase}${config.apiPrefix}/exchange/delivery/${encodeURIComponent(token)}`;

    return {
      ok: true,
      downloadToken: token,
      downloadUrl,
      expiresIn,
      certificateSummary: {
        certificateId: cert?.certificateId || cert?.id || null,
        dnaRecordId: vault.dnaRecordId,
        sha256Prefix: vault.dnaRecord.sha256Hash
          ? String(vault.dnaRecord.sha256Hash).slice(0, 16)
          : null,
        sellerPinitId: toRootPinitId(vault.dnaRecord.ownerUser?.shortId || '') || null,
      },
      monitoring: 'active',
      message: 'Licensed delivery prepared. Master file remains in Hub vault.',
    };
  },

  async redeemDelivery(token: string) {
    const payload = verifyBridgeToken<{
      purpose: string;
      vaultId: string;
      ownerUserId: string;
      orderId: string;
      licenseTier?: string | null;
    }>(token, 'exchange_delivery');

    const { protectedDownloadService } = await import('../vault/protected-download.service');
    const result = await protectedDownloadService.prepare(payload.vaultId, payload.ownerUserId);

    return {
      ...result,
      orderId: payload.orderId,
      licenseTier: payload.licenseTier || null,
    };
  },

  /** Public-safe monitoring / investigation summaries for Exchange seller inbox. */
  async getMonitoringSummaries(pinitIdRaw: string) {
    const resolved = await this.getListableAssetsByPinitId(pinitIdRaw);
    const events = await prisma.platformEvent.findMany({
      where: {
        ownerUserId: resolved.ownerUserId,
        OR: [
          { category: 'investigation' },
          { category: 'monitoring' },
          { category: 'crawler' },
          { name: { contains: 'leak' } },
          { name: { contains: 'match' } },
          { name: { contains: 'investigation' } },
          { name: { contains: 'tamper' } },
        ],
      },
      orderBy: { createdAt: 'desc' },
      take: 40,
      select: {
        id: true,
        name: true,
        category: true,
        severity: true,
        title: true,
        body: true,
        deepLink: true,
        entityId: true,
        entityType: true,
        createdAt: true,
      },
    });

    const hubBase = (config as any).publicAppUrl
      || process.env.PUBLIC_APP_URL
      || 'http://localhost:3000';

    return {
      pinitId: resolved.pinitId,
      summaries: events.map((e) => ({
        id: e.id,
        title: e.title || e.name,
        summary: e.body || '',
        severity: e.severity || 'info',
        category: e.category,
        assetId: e.entityType === 'vault' ? e.entityId : null,
        createdAt: e.createdAt.toISOString(),
        hubDeepLink: e.deepLink?.startsWith('http')
          ? e.deepLink
          : `${String(hubBase).replace(/\/$/, '')}${e.deepLink || '/investigations'}`,
      })),
    };
  },
};

/**
 * Test-only surface for the canonical id resolver. The resolver stays private so
 * callers cannot bypass it; this export exists purely so Phase 1's linkage rules
 * are regression-tested. Not referenced by any runtime code path.
 */
export const __resolveVaultIdFromExchangeIdForTests = resolveVaultIdFromExchangeId;
