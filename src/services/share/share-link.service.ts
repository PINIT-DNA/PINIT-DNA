/**
 * PINIT-DNA — Smart Links Engine Service
 *
 * Creates secure, tracked share links for vault records.
 * Every access is logged: IP, browser, OS, geo, action.
 * Timeline events emitted for: LINK_CREATED, LINK_COPIED, LINK_VIEWED, LINK_DOWNLOADED, LINK_REVOKED
 */

import crypto   from 'crypto';
import axios    from 'axios';
import { prisma } from '../../lib/prisma';
import { logger }  from '../../lib/logger';
import { assertRecordOwner } from '../../lib/tenant-scope';
import { AppError } from '../../api/middleware/error.middleware';
import { riskEngineService, serializeRiskEvidence } from './risk-engine.service';
import { sanitizeCoordinatePair } from '../../lib/geo-coords';
import { getIpIntelligence } from '../forensic/ip-intelligence.service';

// ─── HMAC token signing (integrity layer — detects tampered/guessed tokens) ──
const HMAC_SECRET = process.env['SHARE_HMAC_SECRET'] || 'pinit-dna-dev-secret-change-me';

function signToken(token: string): string {
  return crypto.createHmac('sha256', HMAC_SECRET).update(token).digest('hex');
}

function verifyTokenSignature(token: string, signature: string | null | undefined): boolean {
  if (!signature) return false;
  const expected = signToken(token);
  const a = Buffer.from(expected, 'hex');
  const b = Buffer.from(signature, 'hex');
  return a.length === b.length && crypto.timingSafeEqual(a, b);
}

// ─── OTP helpers (in-app — no external email/SMS provider configured) ────────
// NOTE: actually emailing the OTP requires SMTP credentials (e.g. nodemailer +
// SHARE_SMTP_* env vars), which are not present in this project. The OTP is
// generated and verified server-side; in dev it's returned in the create
// response / logged so the flow can be demoed end-to-end without email infra.
function generateOtp(): string {
  return String(crypto.randomInt(100000, 999999));
}
function hashOtp(otp: string): string {
  return crypto.createHash('sha256').update(otp).digest('hex');
}

// ─── IP Geolocation (ip-api.com — free, no key needed) ───────────────────────
interface GeoInfo { country?: string; city?: string; region?: string; isp?: string; }

export async function geoFromIp(ip: string): Promise<GeoInfo> {
  // Return a local-network label for private/loopback IPs so the UI shows something useful
  if (!ip || ip === '::1' || ip.startsWith('127.') || ip.startsWith('192.168.') || ip.startsWith('10.') || ip.startsWith('172.')) {
    return { country: 'Local Network', city: 'Localhost', region: 'Private', isp: 'Local' };
  }
  try {
    const clean = ip.replace('::ffff:', ''); // strip IPv6-mapped IPv4
    const { data } = await axios.get<{ country?: string; city?: string; regionName?: string; isp?: string; status?: string }>(
      `http://ip-api.com/json/${clean}?fields=status,country,city,regionName,isp`,
      { timeout: 3000 }
    );
    if (data.status === 'success') {
      return { country: data.country, city: data.city, region: data.regionName, isp: data.isp };
    }
  } catch { /* silent — geo is best-effort */ }
  return {};
}

// ─── Types ────────────────────────────────────────────────────────────────────

export interface CreateShareLinkInput {
  vaultId:       string;
  expiresIn?:    number | null;  // hours, null = never
  maxViews?:     number | null;
  allowDownload?: boolean;
  /** Collaboration — turns the secure viewer into a review surface. Off by
   *  default, so an ordinary share is never silently made commentable. */
  reviewMode?: boolean;
  allowComments?: boolean;
  allowChangeRequest?: boolean;
  allowApproval?: boolean;
  /** Who this link is for. Shown to them, and used to attribute what they
   *  write — without it an external creator is labelled "Client". */
  recipientLabel?: string;
  /** Links this share to a ShareRecipient so trust score and device history
   *  accumulate against one identity across their links. */
  shareRecipientId?: string;
  reviewVersionId?: string | null;
  requireName?:  boolean;
  note?:         string;

  // ── Extended access policy ────────────────────────────────────────────
  oneTimeUse?:        boolean;
  maxDownloads?:      number | null;
  allowedCountries?:  string[];
  allowedDeviceTypes?: string[];
  allowedIpPrefixes?: string[];

  // ── Identity verification ─────────────────────────────────────────────
  requireOtp?:     boolean;
  recipientEmail?: string;

  // ── Privacy Masking (viewer-layer only) ───────────────────────────────
  privacyMaskingEnabled?: boolean;
  maskEmail?:             boolean;
  maskPhone?:             boolean;
  maskAadhaar?:           boolean;
  maskPan?:               boolean;
  maskAddress?:           boolean;
  maskCustomPatterns?:    string[];

  // ── GPS Location Request ──────────────────────────────────────────────
  requestLocation?:       boolean;

  // ── Tenant isolation ──────────────────────────────────────────────────
  ownerUserId?:           string;

  // ── Enterprise Security Controls ─────────────────────────────────────
  vpnBlock?:       boolean;
  torBlock?:       boolean;
  oneDeviceOnly?:  boolean;

  // ── Multi-recipient child links ───────────────────────────────────────
  recipients?: Array<{ label: string; email?: string }>;

  /** PARENT (default), FILE (Share File open-on-Pinit page), CHILD/GRANDCHILD (hops) */
  linkType?: string;

  // ── Exchange licensed share ───────────────────────────────────────────
  /** Canonical Asset.id — the identity that crosses the Hub↔Exchange boundary. */
  assetId?:        string;
  /**
   * "hub" (default) = owner sharing their own vault file.
   * "exchange_license" = a BUYER sharing a file they licensed on Exchange. The
   * buyer is deliberately not the vault owner, so the ownership assertion is
   * skipped — the Exchange bridge verifies seal ownership before calling.
   */
  sourceContext?:   string;
  exchangeOrderId?: string;
  exchangeSealId?:  string;
  licenseTier?:     string;
}

export interface ChildLinkResult {
  label:  string;
  token:  string;
  url:    string;
  email?: string;
}

export interface ShareLinkPublicInfo {
  token:        string;
  filename:     string;
  mimeType:     string;
  note:         string | null;
  requireName:  boolean;
  allowDownload: boolean;
  expiresAt:    string | null;
  maxViews:     number | null;
  viewCount:    number;
  isExpired:    boolean;
  isExhausted:  boolean;
  isActive:     boolean;

  oneTimeUse:       boolean;
  maxDownloads:     number | null;
  downloadCount:    number;
  requireOtp:       boolean;
  otpVerified:      boolean;
  signatureValid:   boolean;
  privacyMaskingEnabled: boolean;
  requestLocation:  boolean;
  inactiveReason?:  'expired' | 'exhausted' | 'revoked' | 'one_time' | 'tampered' | null;
  viewerRevoked?:   boolean;
}

export interface AccessLogInput {
  shareLinkId:   string;
  action:        string;
  recipientName?: string;
  ipAddress?:    string;
  userAgent?:    string;
  browser?:      string;
  os?:           string;
  device?:       string;
  country?:      string;
  city?:         string;
  region?:       string;
  isp?:          string;
  timezone?:     string;
  referrer?:     string;
  sessionId?:    string;
  screenResolution?: string;
  deviceFingerprint?: string;
  // GPS — optional, user-consented
  gpsLat?:         number;
  gpsLng?:         number;
  gpsAccuracy?:    number;
  gpsCity?:        string;
  gpsTimestamp?:   Date;
  locationShared?: boolean;
  gpsVillage?:     string;
  gpsMandal?:      string;
  gpsDistrict?:    string;
  gpsState?:       string;
  gpsPincode?:     string;
  gpsFullAddress?: string;
  locationSource?: string;
  // Forensic IP intelligence
  isVpn?:        boolean;
  isTor?:        boolean;
  isProxy?:      boolean;
  isDatacenter?: boolean;
  asn?:          string;
  org?:          string;
  lat?:          number;
  lng?:          number;
  canvasFp?:     string;
  webglFp?:      string;
  audioFp?:      string;
}

export interface PolicyCheckResult {
  allowed: boolean;
  reason?: 'BLOCKED_COUNTRY' | 'BLOCKED_DEVICE' | 'BLOCKED_IP' | 'BLOCKED_OTP_REQUIRED';
  message?: string;
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

/** Generate a short random token: 10 URL-safe chars */
function generateToken(): string {
  return crypto.randomBytes(8).toString('base64url').slice(0, 10);
}

/** Parse User-Agent into browser / OS / device */
function parseUserAgent(ua: string): { browser: string; os: string; device: string } {
  const browser =
    /Edg\//.test(ua)     ? 'Edge' :
    /Chrome\//.test(ua)  ? 'Chrome' :
    /Firefox\//.test(ua) ? 'Firefox' :
    /Safari\//.test(ua)  ? 'Safari' :
    /OPR\//.test(ua)     ? 'Opera' : 'Unknown';

  const os =
    /Windows/.test(ua)  ? 'Windows' :
    /Mac OS/.test(ua)   ? 'macOS' :
    /Linux/.test(ua)    ? 'Linux' :
    /Android/.test(ua)  ? 'Android' :
    /iPhone|iPad/.test(ua) ? 'iOS' : 'Unknown';

  const device =
    /Mobi|Android/.test(ua) ? 'mobile' :
    /Tablet|iPad/.test(ua)  ? 'tablet' : 'desktop';

  return { browser, os, device };
}

/** Case-sensitive first, then unique case-insensitive fallback (screenshots / OCR typos). */
async function findShareLinkByToken(token: string) {
  const exact = await prisma.shareLink.findUnique({ where: { token } });
  if (exact) return exact;
  const rows = await prisma.$queryRawUnsafe<Array<{ token: string }>>(
    `SELECT token FROM share_links WHERE LOWER(token) = LOWER($1) LIMIT 2`,
    token,
  );
  if (rows.length !== 1 || !rows[0]?.token) return null;
  return prisma.shareLink.findUnique({ where: { token: rows[0].token } });
}

// ─── Service ──────────────────────────────────────────────────────────────────

export class ShareLinkService {

  // ── Create share link ─────────────────────────────────────────────────────

  async create(input: CreateShareLinkInput) {
    if (!input.ownerUserId) throw new Error('Authentication required to create share links');

    // Fetch vault + dna record info
    const vault = await prisma.vaultRecord.findUnique({
      where: { id: input.vaultId },
      include: { dnaRecord: { select: { id: true, imageFilename: true, imageMimeType: true, ownerUserId: true } } },
    });
    if (!vault) throw new Error(`Vault record not found: ${input.vaultId}`);

    // A licensed Exchange share is created BY THE BUYER, who is not the vault
    // owner — so the ownership assertion cannot apply. Authorisation for that
    // path is the seal check the Exchange bridge performs before calling
    // (buyer_pinit_id on orders_sealed), plus the bridge secret itself.
    // Ordinary Hub shares keep the owner assertion unconditionally.
    const isLicensedShare = input.sourceContext === 'exchange_license';
    if (isLicensedShare) {
      if (!input.exchangeSealId) {
        throw new Error('exchangeSealId is required for an exchange_license share');
      }
    } else {
      assertRecordOwner(vault.dnaRecord?.ownerUserId, input.ownerUserId, 'Vault');
    }

    // Generate unique token
    let token = generateToken();
    let attempts = 0;
    while (await prisma.shareLink.findUnique({ where: { token } })) {
      token = generateToken();
      if (++attempts > 10) throw new Error('Failed to generate unique token');
    }

    const expiresAt = input.expiresIn
      ? new Date(Date.now() + input.expiresIn * 3_600_000)
      : null;

    // Sign the token (HMAC-SHA256) — integrity layer verified on every lookup
    const tokenSignature = signToken(token);

    // Generate OTP if email-gate requested (no SMTP configured — see note above)
    let otpCodeHash: string | null = null;
    let otpExpiresAt: Date | null = null;
    let plainOtp: string | null = null;
    if (input.requireOtp && input.recipientEmail) {
      plainOtp = generateOtp();
      otpCodeHash = hashOtp(plainOtp);
      otpExpiresAt = new Date(Date.now() + 15 * 60_000); // 15 min validity
      logger.info('[SmartLink] OTP generated for recipient (no SMTP configured — logging for demo)', {
        recipientEmail: input.recipientEmail, otp: plainOtp,
      });
    }

    // Review mode needs the canonical Asset.id, because the client's scope is
    // resolved through it: token -> assetId -> campaign -> organization. The
    // share dialog creates links by vaultId, so resolve it here rather than
    // relying on every caller to remember — a review link with a null assetId
    // would look created but resolve to nothing.
    let resolvedAssetId: string | null = input.assetId ?? null;
    if (input.reviewMode && !resolvedAssetId) {
      const asset = await prisma.asset.findFirst({
        where: { vaultId: vault.id },
        select: { id: true, campaignId: true },
        orderBy: { createdAt: 'desc' },
      });
      if (!asset) {
        throw new AppError(400, 'Review needs an asset record for this file. Protect it into a campaign first.');
      }
      if (!asset.campaignId) {
        throw new AppError(
          400,
          'Review is only available for assets in a campaign. Add this asset to a campaign, then share it again.',
        );
      }
      resolvedAssetId = asset.id;
    }

    const link = await prisma.shareLink.create({
      data: {
        token,
        tokenSignature,
        vaultId:      vault.id,
        dnaRecordId:  vault.dnaRecordId,
        filename:     vault.originalFileName,
        mimeType:     vault.originalMimeType,
        assetId:         resolvedAssetId,
        sourceContext:   input.sourceContext ?? 'hub',
        exchangeOrderId: input.exchangeOrderId ?? null,
        exchangeSealId:  input.exchangeSealId ?? null,
        licenseTier:     input.licenseTier ?? null,
        expiresAt,
        maxViews:     input.maxViews ?? null,
        allowDownload: input.allowDownload ?? false,

        // Comments only mean anything in review mode, so they are gated on it
        // rather than trusted independently — a caller cannot enable commenting
        // on a link that is not a review link.
        reviewMode:         input.reviewMode ?? false,
        allowComments:      Boolean(input.reviewMode && (input.allowComments ?? true)),
        allowChangeRequest: Boolean(input.reviewMode && (input.allowChangeRequest ?? true)),
        // Approval is opt-in even inside review mode: it is a decision someone
        // may be held to, not a discussion.
        allowApproval:      Boolean(input.reviewMode && (input.allowApproval ?? false)),
        reviewVersionId:    input.reviewMode ? (input.reviewVersionId ?? null) : null,
        recipientLabel:     input.recipientLabel?.trim() || null,
        shareRecipientId:   input.shareRecipientId ?? null,
        requireName:  input.requireName ?? false,
        note:         input.note ?? null,

        oneTimeUse:        input.oneTimeUse ?? false,
        maxDownloads:      input.maxDownloads ?? null,
        allowedCountries:  input.allowedCountries ?? [],
        allowedDeviceTypes: input.allowedDeviceTypes ?? [],
        allowedIpPrefixes: input.allowedIpPrefixes ?? [],

        requireOtp:     input.requireOtp ?? false,
        recipientEmail: input.recipientEmail ?? null,
        otpCodeHash,
        otpExpiresAt,

        // Privacy Masking — viewer-layer only
        privacyMaskingEnabled: input.privacyMaskingEnabled ?? false,
        maskEmail:             input.maskEmail    ?? false,
        maskPhone:             input.maskPhone    ?? false,
        maskAadhaar:           input.maskAadhaar  ?? false,
        maskPan:               input.maskPan      ?? false,
        maskAddress:           input.maskAddress  ?? false,
        maskCustomPatterns:    input.maskCustomPatterns?.length
          ? JSON.stringify(input.maskCustomPatterns)
          : null,
        // GPS Location Request
        requestLocation: input.requestLocation ?? false,

        // Enterprise security controls
        vpnBlock:      input.vpnBlock      ?? false,
        torBlock:      input.torBlock      ?? true,
        oneDeviceOnly: input.oneDeviceOnly ?? false,

        // Tenant isolation
        ownerUserId: input.ownerUserId,

        // PARENT (Share Secure Link) vs FILE (Share File → open on Pinit page)
        linkType: input.linkType ?? 'PARENT',
      },
    });

    logger.info('[SmartLink] Created', { token, filename: vault.originalFileName, expiresAt });

    import('../platform-events/module-events').then(({ emitShareLinkCreated }) => {
      emitShareLinkCreated({
        ownerUserId: input.ownerUserId!,
        shareLinkId: link.id,
        token: link.token,
        filename: vault.originalFileName,
        dnaRecordId: vault.dnaRecordId,
        vaultId: vault.id,
      });
    }).catch(() => {});

    // If recipients provided, auto-create child links
    let childLinks: ChildLinkResult[] = [];
    if (input.recipients && input.recipients.length > 0) {
      childLinks = await this._createChildLinks(link.id, link, input.recipients);
    }

    return { ...link, devOtp: plainOtp, childLinks };
  }

  /**
   * Share File channel: open on Pinit `/s/:token` page so views are tracked.
   * Reuses the latest active FILE link for the vault when available.
   */
  async createOrGetFileShare(input: {
    vaultId: string;
    ownerUserId: string;
    requestLocation?: boolean;
  }) {
    if (!input.ownerUserId) throw new Error('Authentication required to create file shares');

    const existing = await prisma.shareLink.findFirst({
      where: {
        vaultId: input.vaultId,
        ownerUserId: input.ownerUserId,
        linkType: 'FILE',
        isActive: true,
      },
      orderBy: { createdAt: 'desc' },
    });

    if (existing) {
      const expired = existing.expiresAt != null && existing.expiresAt.getTime() <= Date.now();
      const exhausted =
        existing.maxViews != null && existing.viewCount >= existing.maxViews;
      if (!expired && !exhausted) {
        return { ...existing, reused: true as const };
      }
    }

    const created = await this.create({
      vaultId: input.vaultId,
      ownerUserId: input.ownerUserId,
      linkType: 'FILE',
      allowDownload: true,
      requestLocation: input.requestLocation ?? true,
      note: 'Share File — opens on Pinit HUB for tracking',
    });

    return { ...created, reused: false as const };
  }

  // ── Create child links for each recipient ─────────────────────────────────

  private async _createChildLinks(
    parentLinkId: string,
    parent: { token: string; vaultId: string; dnaRecordId: string; filename: string; mimeType: string;
              expiresAt: Date | null; maxViews: number | null; allowDownload: boolean; requireName: boolean;
              note: string | null; oneTimeUse: boolean; maxDownloads: number | null;
              allowedCountries: string[]; allowedDeviceTypes: string[]; allowedIpPrefixes: string[];
              requireOtp: boolean; privacyMaskingEnabled: boolean; maskEmail: boolean; maskPhone: boolean;
              maskAadhaar: boolean; maskPan: boolean; maskAddress: boolean; maskCustomPatterns: string | null;
              requestLocation: boolean; ownerUserId: string | null; tokenSignature: string | null; },
    recipients: Array<{ label: string; email?: string }>
  ): Promise<ChildLinkResult[]> {
    const appUrl = process.env['PUBLIC_APP_URL'] ?? 'http://localhost:3000';
    const results: ChildLinkResult[] = [];

    for (const recipient of recipients) {
      let token = generateToken();
      let attempts = 0;
      while (await prisma.shareLink.findUnique({ where: { token } })) {
        token = generateToken();
        if (++attempts > 10) throw new Error('Failed to generate unique child token');
      }
      const tokenSignature = signToken(token);

      const child = await prisma.shareLink.create({
        data: {
          token,
          tokenSignature,
          vaultId:      parent.vaultId,
          dnaRecordId:  parent.dnaRecordId,
          filename:     parent.filename,
          mimeType:     parent.mimeType,
          expiresAt:    parent.expiresAt,
          maxViews:     parent.maxViews,
          allowDownload: parent.allowDownload,
          requireName:  parent.requireName,
          note:         parent.note,
          oneTimeUse:   parent.oneTimeUse,
          maxDownloads: parent.maxDownloads,
          allowedCountries:   parent.allowedCountries,
          allowedDeviceTypes: parent.allowedDeviceTypes,
          allowedIpPrefixes:  parent.allowedIpPrefixes,
          requireOtp:   parent.requireOtp,
          recipientEmail: recipient.email ?? null,
          privacyMaskingEnabled: parent.privacyMaskingEnabled,
          maskEmail:    parent.maskEmail,
          maskPhone:    parent.maskPhone,
          maskAadhaar:  parent.maskAadhaar,
          maskPan:      parent.maskPan,
          maskAddress:  parent.maskAddress,
          maskCustomPatterns: parent.maskCustomPatterns,
          requestLocation: parent.requestLocation,
          ownerUserId:  parent.ownerUserId,
          // Hierarchy fields
          linkType:     'CHILD',
          parentLinkId,
          depth:        1,
          recipientLabel: recipient.label,
        },
      });

      results.push({
        label: recipient.label,
        token: child.token,
        url:   `${appUrl}/s/${child.token}`,
        email: recipient.email,
      });
      logger.info('[SmartLink] Child link created', { parentToken: parent.token, childToken: token, recipient: recipient.label });
    }

    return results;
  }

  /**
   * Forward / hop graph algorithm
   * ─────────────────────────────────────────────────────────────────────────
   * Every unique recipient device that opens a share URL should get its OWN
   * child token with a separate timeline — not silently share the same logs.
   *
   * Rules:
   *  1. Skip link-preview bots (WhatsApp/Telegram OG scrapers) — never anchor
   *     or mint hops for them (they would steal the "intended" slot).
   *  2. First real viewer of a token becomes the intended recipient (device + IP).
   *  3. Same device fingerprint → stay on this token (one timeline per person/device).
   *  4. New device fingerprint → mint (or reuse) a child hop, redirect there.
   *  5. Depth is unlimited: PARENT → CHILD → GRANDCHILD → deeper GRANDCHILD…
   *  6. Explicit "Share further" also mints a fresh unused child URL to copy.
   */

  private isLikelyLinkPreviewBot(ua: string | null | undefined): boolean {
    if (!ua) return false;
    return /bot|crawl|spider|slurp|facebookexternalhit|facebot|WhatsApp|TelegramBot|Twitterbot|LinkedInBot|Discordbot|Slackbot|SkypeUriPreview|preview/i.test(ua);
  }

  private async mintUniqueToken(): Promise<string> {
    let token = generateToken();
    let attempts = 0;
    while (await prisma.shareLink.findUnique({ where: { token } })) {
      token = generateToken();
      if (++attempts > 12) throw new Error('Failed to mint unique share hop token');
    }
    return token;
  }

  /** Clone parent policies into a new hop child with its own token + timeline. */
  private async createHopLink(opts: {
    parentId: string;
    recipientLabel: string;
    forwardedByLabel: string | null;
    intendedIp?: string | null;
    intendedFingerprint?: string | null;
  }): Promise<{ id: string; token: string; depth: number; linkType: string }> {
    const parent = await prisma.shareLink.findUnique({ where: { id: opts.parentId } });
    if (!parent) throw new Error('Parent share link not found');

    const token = await this.mintUniqueToken();
    const depth = (parent.depth ?? 0) + 1;
    const linkType = depth <= 1 ? 'CHILD' : 'GRANDCHILD';

    const hop = await prisma.shareLink.create({
      data: {
        token,
        tokenSignature: signToken(token),
        vaultId: parent.vaultId,
        dnaRecordId: parent.dnaRecordId,
        filename: parent.filename,
        mimeType: parent.mimeType,
        expiresAt: parent.expiresAt,
        maxViews: null, // each hop recipient gets their own quota — don't inherit parent cap
        allowDownload: parent.allowDownload,
        requireName: parent.requireName,
        note: parent.note,
        oneTimeUse: false, // each hop is independent; don't inherit one-shot of parent
        maxDownloads: parent.maxDownloads,
        allowedCountries: parent.allowedCountries,
        allowedDeviceTypes: parent.allowedDeviceTypes,
        allowedIpPrefixes: parent.allowedIpPrefixes,
        requireOtp: false, // otp already cleared on ancestor for this distribution chain
        privacyMaskingEnabled: parent.privacyMaskingEnabled,
        maskEmail: parent.maskEmail,
        maskPhone: parent.maskPhone,
        maskAadhaar: parent.maskAadhaar,
        maskPan: parent.maskPan,
        maskAddress: parent.maskAddress,
        maskCustomPatterns: parent.maskCustomPatterns,
        requestLocation: parent.requestLocation,
        vpnBlock: parent.vpnBlock,
        torBlock: parent.torBlock,
        ownerUserId: parent.ownerUserId,
        linkType,
        parentLinkId: parent.id,
        depth,
        recipientLabel: opts.recipientLabel,
        forwardedByLabel: opts.forwardedByLabel,
        intendedIpAddress: opts.intendedIp ?? null,
        intendedDeviceFingerprint: opts.intendedFingerprint ?? null,
      },
    });

    logger.info('[SmartLink] Hop link minted', {
      parentToken: parent.token,
      hopToken: hop.token,
      depth,
      linkType,
      recipientLabel: opts.recipientLabel,
    });

    return { id: hop.id, token: hop.token, depth, linkType };
  }

  /**
   * On VIEWED: bind first viewer OR redirect a new device onto a fresh hop token.
   * Returns redirectToken when the client must navigate to /s/{redirectToken}.
   */
  async resolveAccessHop(
    link: {
      id: string; token: string; linkType: string; depth: number;
      recipientLabel: string | null; intendedIpAddress: string | null;
      intendedDeviceFingerprint: string | null; forwardingDetected: boolean;
      parentLinkId: string | null;
    },
    incomingIp: string,
    incomingFingerprint: string | null,
    accessInfo: {
      country?: string; city?: string; browser?: string; os?: string;
      userAgent?: string; recipientName?: string;
    },
  ): Promise<{ forwarded: boolean; redirectToken?: string; hopCreated?: boolean }> {
    if (this.isLikelyLinkPreviewBot(accessInfo.userAgent)) {
      return { forwarded: false };
    }

    const fp = incomingFingerprint?.trim() || null;

    // First real human access — anchor this token to this device
    if (!link.intendedDeviceFingerprint && !link.intendedIpAddress) {
      await prisma.shareLink.update({
        where: { id: link.id },
        data: {
          intendedIpAddress: incomingIp || null,
          intendedDeviceFingerprint: fp,
          ...(accessInfo.recipientName && !link.recipientLabel
            ? { recipientLabel: accessInfo.recipientName }
            : {}),
        },
      });
      return { forwarded: false };
    }

    // Same device fingerprint → same hop / same timeline
    if (fp && link.intendedDeviceFingerprint && fp === link.intendedDeviceFingerprint) {
      return { forwarded: false };
    }

    // No fingerprint available: fall back to /24 subnet match (weaker)
    if (!fp) {
      const intended = link.intendedIpAddress ?? '';
      const sameSubnet =
        intended.includes('.') &&
        incomingIp.includes('.') &&
        intended.split('.').slice(0, 3).join('.') === incomingIp.split('.').slice(0, 3).join('.');
      if (sameSubnet) return { forwarded: false };
    }

    // Reuse an existing hop already minted for this fingerprint under this parent
    if (fp) {
      const existing = await prisma.shareLink.findFirst({
        where: {
          parentLinkId: link.id,
          intendedDeviceFingerprint: fp,
          isActive: true,
        },
        orderBy: { createdAt: 'asc' },
      });
      if (existing) {
        await prisma.shareLink.update({
          where: { id: link.id },
          data: { forwardingDetected: true },
        });
        return { forwarded: true, redirectToken: existing.token, hopCreated: false };
      }
    }

    const forwardedBy =
      link.recipientLabel ??
      accessInfo.recipientName ??
      (link.linkType === 'PARENT' ? 'original link' : 'prior hop');
    const hopLabel =
      accessInfo.recipientName?.trim() ||
      `Forward hop (from ${forwardedBy})`;

    const hop = await this.createHopLink({
      parentId: link.id,
      recipientLabel: hopLabel,
      forwardedByLabel: forwardedBy,
      intendedIp: incomingIp || null,
      intendedFingerprint: fp,
    });

    await prisma.shareLink.update({
      where: { id: link.id },
      data: { forwardingDetected: true },
    });

    await prisma.linkForwardEvent.create({
      data: {
        shareLinkId: link.id,
        intendedRecipient: link.recipientLabel ?? null,
        intendedIp: link.intendedIpAddress,
        intendedDevice: link.intendedDeviceFingerprint,
        newIp: incomingIp,
        newDevice: fp,
        newCountry: accessInfo.country ?? null,
        newCity: accessInfo.city ?? null,
        newBrowser: accessInfo.browser ?? null,
        newOs: accessInfo.os ?? null,
        grandchildToken: hop.token,
        action: 'HOP_MINTED',
      },
    }).catch((err) => {
      logger.warn('[SmartLink] linkForwardEvent write failed', { error: String(err) });
    });

    logger.warn('[SmartLink] Forward hop minted — redirect recipient to new URL', {
      fromToken: link.token,
      redirectToken: hop.token,
      depth: hop.depth,
    });

    return { forwarded: true, redirectToken: hop.token, hopCreated: true };
  }

  /** Explicit "Share further": mint a fresh child URL the current viewer can send on WhatsApp. */
  async mintShareFurther(
    parentToken: string,
    opts?: { recipientLabel?: string; forwardedByLabel?: string },
  ): Promise<{ token: string; parentToken: string; depth: number; linkType: string }> {
    const parent = await prisma.shareLink.findUnique({ where: { token: parentToken } });
    if (!parent || !parent.isActive) {
      throw Object.assign(new Error('Share link not found or revoked'), { statusCode: 404 });
    }

    const hop = await this.createHopLink({
      parentId: parent.id,
      recipientLabel: opts?.recipientLabel?.trim() || `Shared further from ${parent.recipientLabel ?? parent.token}`,
      forwardedByLabel: opts?.forwardedByLabel?.trim() || parent.recipientLabel || parent.token,
      // Leave intended empty — next opener of THIS new URL becomes the hop's recipient
      intendedIp: null,
      intendedFingerprint: null,
    });

    await prisma.shareLink.update({
      where: { id: parent.id },
      data: { forwardingDetected: true },
    });

    await prisma.linkForwardEvent.create({
      data: {
        shareLinkId: parent.id,
        intendedRecipient: parent.recipientLabel,
        intendedIp: parent.intendedIpAddress,
        intendedDevice: parent.intendedDeviceFingerprint,
        grandchildToken: hop.token,
        action: 'SHARE_FURTHER',
      },
    }).catch(() => {});

    return {
      token: hop.token,
      parentToken: parent.token,
      depth: hop.depth,
      linkType: hop.linkType,
    };
  }

  /** @deprecated Prefer resolveAccessHop — kept for callers that still use the old name. */
  async detectForwarding(
    link: { id: string; token: string; linkType: string; depth: number;
            recipientLabel: string | null; intendedIpAddress: string | null;
            intendedDeviceFingerprint: string | null; forwardingDetected: boolean;
            parentLinkId: string | null; },
    incomingIp: string,
    incomingFingerprint: string | null,
    accessInfo: { country?: string; city?: string; browser?: string; os?: string; userAgent?: string; recipientName?: string }
  ): Promise<{ forwarded: boolean; grandchildToken?: string }> {
    const result = await this.resolveAccessHop(link, incomingIp, incomingFingerprint, accessInfo);
    return { forwarded: result.forwarded, grandchildToken: result.redirectToken };
  }

  // ── Tamper check: verify file hash on every serve ─────────────────────────

  async checkFileTamper(
    dnaRecordId: string, vaultId: string, fileBuffer: Buffer,
    shareToken?: string, accessorIp?: string, accessorDevice?: string
  ): Promise<{ tampered: boolean }> {
    const dnaRecord = await prisma.dnaRecord.findUnique({
      where: { id: dnaRecordId },
      include: { cryptoLayer: true },
    });

    const storedHash = dnaRecord?.cryptoLayer?.sha256Hash ?? dnaRecord?.sha256Hash;
    if (!storedHash) return { tampered: false }; // no hash to compare

    const { createHash } = await import('crypto');
    const detectedHash = createHash('sha256').update(fileBuffer).digest('hex');

    if (storedHash.toLowerCase() === detectedHash.toLowerCase()) {
      return { tampered: false };
    }

    // TAMPER DETECTED
    logger.error('[TamperDetection] File hash mismatch!', { dnaRecordId, storedHash, detectedHash });

    // Suspend all active child links for this vault
    const suspended = await prisma.shareLink.updateMany({
      where: { vaultId, isActive: true, linkType: { in: ['CHILD', 'GRANDCHILD'] } },
      data:  { isActive: false },
    });

    // Log tamper event
    await prisma.fileTamperEvent.create({
      data: {
        dnaRecordId, vaultId,
        shareToken:    shareToken ?? null,
        storedHash,
        detectedHash,
        accessorIp:    accessorIp ?? null,
        accessorDevice: accessorDevice ?? null,
        linksSupended: suspended.count,
      },
    });

    return { tampered: true };
  }

  // ── Get link tree (parent + all children + grandchildren) ─────────────────

  async getLinkTree(parentToken: string, ownerUserId: string) {
    const hopInclude = {
      accessLogs: { orderBy: { createdAt: 'desc' as const }, take: 8 },
      forwardEvents: true,
    };

    const parent = await prisma.shareLink.findUnique({
      where: { token: parentToken },
      include: {
        ...hopInclude,
        childLinks: {
          include: {
            ...hopInclude,
            childLinks: {
              include: {
                ...hopInclude,
                childLinks: {
                  include: hopInclude, // depth 4 hops visible in tree
                },
              },
            },
          },
        },
      },
    });

    if (!parent) throw new Error('Share link not found');
    if (parent.ownerUserId !== ownerUserId) throw new Error('Access denied');

    return parent;
  }

  // ── Get link public info (no auth required) ───────────────────────────────

  /** Walk parentLinkId chain — used for per-viewer blocks on hop trees. */
  private async getShareLinkAncestryIds(shareLinkId: string): Promise<string[]> {
    const ids: string[] = [shareLinkId];
    let currentId = shareLinkId;
    for (let depth = 0; depth < 32; depth++) {
      const parentRow = await prisma.shareLink.findUnique({
        where: { id: currentId },
        select: { parentLinkId: true },
      });
      const parentId = parentRow?.parentLinkId;
      if (!parentId) break;
      ids.push(parentId);
      currentId = parentId;
    }
    return ids;
  }

  /** All descendant hop link ids under a root share link (BFS, max depth 32). */
  private async getShareLinkDescendantIds(rootId: string): Promise<string[]> {
    const ids: string[] = [];
    let frontier = [rootId];
    for (let depth = 0; depth < 32 && frontier.length > 0; depth++) {
      const children = await prisma.shareLink.findMany({
        where: { parentLinkId: { in: frontier } },
        select: { id: true },
      });
      const childIds = children.map(c => c.id);
      if (!childIds.length) break;
      ids.push(...childIds);
      frontier = childIds;
    }
    return ids;
  }

  async getPublicInfo(
    token: string,
    viewer?: { deviceFingerprint?: string | null; sessionId?: string | null; ipAddress?: string | null },
  ): Promise<ShareLinkPublicInfo | null> {
    let link = await findShareLinkByToken(token);
    if (!link) return null;

    const isHop = link.linkType === 'CHILD' || link.linkType === 'GRANDCHILD';

    // Legacy hops may have inherited oneTimeUse=true and been auto-deactivated after
    // the first VIEWED — heal so other recipients on their own hop URLs keep access.
    if (isHop && link.oneTimeUse && !link.isActive) {
      link = await prisma.shareLink.update({
        where: { id: link.id },
        data: { isActive: true, oneTimeUse: false },
      });
      logger.info('[SmartLink] Healed legacy hop oneTimeUse deactivation', { token: link.token });
    }

    // Legacy hops inherited parent maxViews — clear so one recipient doesn't exhaust the hop for everyone.
    if (isHop && link.maxViews != null) {
      link = await prisma.shareLink.update({
        where: { id: link.id },
        data: { maxViews: null },
      });
      logger.info('[SmartLink] Cleared inherited maxViews on hop link', { token: link.token });
    }

    const isExpired   = !!link.expiresAt && new Date(link.expiresAt) < new Date();
    const isExhausted = !!link.maxViews  && link.viewCount >= link.maxViews;
    const isParent    = link.linkType === 'PARENT';

    // ── HMAC integrity check — a token whose signature doesn't match the
    //    server secret was either forged, guessed, or predates signing
    //    (legacy links created before this feature shipped get `null`
    //    signatures and are treated as "unsigned, but not flagged tampered").
    // Use DB token (canonical casing), not the typed URL token.
    const signatureValid = link.tokenSignature
      ? verifyTokenSignature(link.token, link.tokenSignature)
      : true; // unsigned legacy link — don't false-flag it as tampered

    if (link.tokenSignature && !signatureValid) {
      logger.warn('[SmartLink] HMAC signature mismatch — possible tampered/forged token', { token: link.token });
    }

    let inactiveReason: ShareLinkPublicInfo['inactiveReason'] = null;
    if (!signatureValid) inactiveReason = 'tampered';
    else if (isExpired) inactiveReason = 'expired';
    else if (isExhausted) inactiveReason = 'exhausted';
    else if (!link.isActive && !isParent) {
      inactiveReason = link.oneTimeUse ? 'one_time' : 'revoked';
    } else if (!link.isActive && isParent && link.oneTimeUse) {
      inactiveReason = 'one_time';
    }

    // PARENT links stay open for new devices to mint hop URLs even after oneTimeUse consumed the row.
    const parentAcceptsForwards = isParent && !isExpired && !isExhausted && signatureValid;
    const linkAccessible =
      !isExpired &&
      !isExhausted &&
      signatureValid &&
      (link.isActive || parentAcceptsForwards);

    let viewerRevoked = false;
    if (viewer && (viewer.deviceFingerprint || viewer.sessionId || viewer.ipAddress)) {
      viewerRevoked = await this.isViewerBlocked(link.id, viewer);
    }

    return {
      token:         link.token,
      filename:      link.filename,
      mimeType:      link.mimeType,
      note:          link.note,
      requireName:   link.requireName,
      allowDownload: link.allowDownload,
      expiresAt:     link.expiresAt?.toISOString() ?? null,
      maxViews:      link.maxViews,
      viewCount:     link.viewCount,
      isExpired,
      isExhausted,
      isActive:      linkAccessible,

      oneTimeUse:    link.oneTimeUse,
      maxDownloads:  link.maxDownloads,
      downloadCount: link.downloadCount,
      requireOtp:    link.requireOtp,
      otpVerified:   link.otpVerified,
      signatureValid,
      privacyMaskingEnabled: link.privacyMaskingEnabled,
      requestLocation:       link.requestLocation,
      inactiveReason,
      viewerRevoked,
    };
  }

  // ── Verify recipient-entered OTP ──────────────────────────────────────────

  async verifyOtp(token: string, otp: string): Promise<{ ok: boolean; message: string }> {
    const link = await findShareLinkByToken(token);
    if (!link) return { ok: false, message: 'Link not found' };
    if (!link.requireOtp) return { ok: true, message: 'OTP not required' };
    if (!link.otpCodeHash) return { ok: false, message: 'No OTP was generated for this link' };
    if (link.otpExpiresAt && new Date(link.otpExpiresAt) < new Date()) {
      return { ok: false, message: 'OTP has expired — ask the sender for a new link' };
    }
    if (hashOtp(otp) !== link.otpCodeHash) {
      return { ok: false, message: 'Incorrect code — please try again' };
    }
    await prisma.shareLink.update({ where: { id: link.id }, data: { otpVerified: true } });
    logger.info('[SmartLink] OTP verified', { token: link.token });
    return { ok: true, message: 'Verified' };
  }

  // ── Policy enforcement (device / geo / IP allow-lists) ────────────────────
  // Returns `allowed: false` with a reason if the requesting context violates
  // any non-empty allow-list configured on the link. Empty list = no restriction.

  checkPolicy(
    link: { allowedCountries: string[]; allowedDeviceTypes: string[]; allowedIpPrefixes: string[] },
    ctx: { country?: string | null; device?: string | null; ipAddress?: string | null }
  ): PolicyCheckResult {
    if (link.allowedCountries?.length && ctx.country) {
      // Private / loopback IPs cannot be geolocated (localhost, LAN). They are
      // labeled "Local Network" — blocking them as "not India" is a false positive
      // during local testing. Real public IPs still go through country allow-list.
      const countryLower = ctx.country.toLowerCase();
      const ip = (ctx.ipAddress ?? '').replace('::ffff:', '');
      const isPrivateIp =
        !ip ||
        ip === '::1' ||
        ip.startsWith('127.') ||
        ip.startsWith('192.168.') ||
        ip.startsWith('10.') ||
        /^172\.(1[6-9]|2\d|3[0-1])\./.test(ip) ||
        countryLower === 'local network' ||
        countryLower === 'localhost' ||
        countryLower === 'private';

      if (!isPrivateIp) {
        // Normalise: convert geo-IP full name ("India") to ISO code ("IN") so it matches
        // stored values (VaultPage saves ISO codes). Also accept direct full-name match.
        const countryIsoMap: Record<string, string> = {
          'india': 'IN', 'united states': 'US', 'united states of america': 'US',
          'united kingdom': 'GB', 'australia': 'AU', 'canada': 'CA',
          'germany': 'DE', 'france': 'FR', 'japan': 'JP', 'china': 'CN',
          'singapore': 'SG', 'united arab emirates': 'AE', 'russia': 'RU',
          'brazil': 'BR', 'south africa': 'ZA', 'italy': 'IT', 'spain': 'ES',
          'netherlands': 'NL', 'new zealand': 'NZ', 'pakistan': 'PK',
          'bangladesh': 'BD', 'sri lanka': 'LK', 'indonesia': 'ID',
          'malaysia': 'MY', 'thailand': 'TH', 'philippines': 'PH',
          'south korea': 'KR', 'taiwan': 'TW', 'hong kong': 'HK',
          'mexico': 'MX', 'argentina': 'AR', 'chile': 'CL', 'colombia': 'CO',
          'sweden': 'SE', 'norway': 'NO', 'denmark': 'DK', 'finland': 'FI',
          'poland': 'PL', 'ukraine': 'UA', 'turkey': 'TR', 'egypt': 'EG',
          'nigeria': 'NG', 'kenya': 'KE', 'ghana': 'GH',
        };
        const geoKey    = countryLower;
        const geoIso    = countryIsoMap[geoKey] ?? ctx.country.toUpperCase().slice(0, 2);
        const geoName   = ctx.country;
        const allowed   = link.allowedCountries;
        const match = allowed.some(a =>
          a.toUpperCase() === geoIso ||
          a.toLowerCase() === geoKey ||
          a.toLowerCase() === geoName.toLowerCase()
        );
        if (!match) {
          return { allowed: false, reason: 'BLOCKED_COUNTRY', message: `Access from ${ctx.country} is not permitted. Allowed: ${allowed.join(', ')}` };
        }
      }
    }
    if (link.allowedDeviceTypes?.length && ctx.device) {
      const deviceLower = ctx.device.toLowerCase();
      if (!link.allowedDeviceTypes.map(d => d.toLowerCase()).includes(deviceLower)) {
        return { allowed: false, reason: 'BLOCKED_DEVICE', message: `${ctx.device} devices are not permitted. Allowed: ${link.allowedDeviceTypes.join(', ')}` };
      }
    }
    if (link.allowedIpPrefixes?.length && ctx.ipAddress) {
      const matches = link.allowedIpPrefixes.some(prefix => ctx.ipAddress!.startsWith(prefix));
      if (!matches) {
        return { allowed: false, reason: 'BLOCKED_IP', message: 'Your IP address is not in the permitted range for this link' };
      }
    }
    return { allowed: true };
  }

  // ── Record an access event ────────────────────────────────────────────────

  async recordAccess(input: AccessLogInput) {
    // [DEBUG] Stage-3a: log what the service received
    logger.debug('[IP-AUDIT] Stage-3a service.recordAccess received', {
      action:    input.action,
      ipAddress: input.ipAddress ?? 'NULL/UNDEFINED',
    });

    const link = await prisma.shareLink.findUnique({ where: { id: input.shareLinkId } });
    if (!link) return;

    const ua = input.userAgent ?? '';
    const { browser, os, device } = parseUserAgent(ua);
    // Improve device detection: screen width < 768 is almost certainly mobile
    let finalDevice = input.device ?? device;
    if (finalDevice === 'desktop' && input.screenResolution) {
      const w = parseInt(input.screenResolution.split('x')[0], 10);
      if (w > 0 && w < 768) finalDevice = 'Mobile';
      else if (w >= 768 && w < 1024) finalDevice = 'Tablet';
      else finalDevice = 'Desktop';
    } else {
      finalDevice = finalDevice === 'mobile' ? 'Mobile' : finalDevice === 'tablet' ? 'Tablet' : 'Desktop';
    }

    // Auto-geolocate if country not provided
    let country = input.country ?? null;
    let city    = input.city    ?? null;
    let region  = input.region  ?? null;
    let isp     = input.isp     ?? null;
    if (!country && input.ipAddress) {
      const geo = await geoFromIp(input.ipAddress);
      country = geo.country ?? null;
      city    = geo.city    ?? null;
      region  = region ?? geo.region ?? null;
      isp     = isp    ?? geo.isp    ?? null;
    }

    let ipLat = input.lat;
    let ipLng = input.lng;
    // Always resolve IP geo when missing — needed for Fake GPS (GPS vs IP) comparison
    if ((ipLat == null || ipLng == null) && input.ipAddress) {
      try {
        const intel = await getIpIntelligence(input.ipAddress);
        const c = sanitizeCoordinatePair(intel.lat, intel.lng);
        if (c) {
          ipLat = c.lat;
          ipLng = c.lng;
        }
        if (!country && intel.country) country = intel.country;
        if (!city && intel.city) city = intel.city;
        if (!region && intel.region) region = intel.region;
        if (!isp && intel.isp) isp = intel.isp;
        // Prefer intel VPN/Tor flags when caller did not set them
        if (input.isVpn == null && intel.isVpn) input.isVpn = true;
        if (input.isTor == null && intel.isTor) input.isTor = true;
        if (input.isProxy == null && intel.isProxy) input.isProxy = true;
      } catch { /* best-effort */ }
    }

    // Override IP-based city with GPS city when available (GPS is more accurate)
    if (input.gpsCity) {
      city = input.gpsCity;
    }

    // ── Session duration: time elapsed since the first event of this session
    let sessionDurationSec: number | null = null;
    if (input.sessionId) {
      const firstInSession = await prisma.shareAccessLog.findFirst({
        where:   { shareLinkId: input.shareLinkId, sessionId: input.sessionId },
        orderBy: { createdAt: 'asc' },
      });
      if (firstInSession) {
        sessionDurationSec = Math.max(0, Math.round((Date.now() - new Date(firstInSession.createdAt).getTime()) / 1000));
      } else {
        sessionDurationSec = 0; // this IS the first event of the session
      }
    }

    const history = await prisma.shareAccessLog.findMany({
      where:   { shareLinkId: input.shareLinkId },
      orderBy: { createdAt: 'desc' },
      take:    50,
      select:  {
        action: true, country: true, city: true, region: true,
        ipAddress: true, device: true, browser: true, createdAt: true,
        gpsLat: true, gpsLng: true, deviceFingerprint: true,
      },
    });
    const risk = riskEngineService.score({
      action: input.action,
      country, city, region, device: finalDevice,
      browser: input.browser ?? browser,
      os: input.os ?? os,
      ipAddress: input.ipAddress ?? null,
      gpsLat: input.gpsLat ?? null,
      gpsLng: input.gpsLng ?? null,
      gpsAccuracyM: input.gpsAccuracy ?? null,
      ipLat: ipLat ?? null,
      ipLng: ipLng ?? null,
      isVpn: input.isVpn ?? false,
      isTor: input.isTor ?? false,
      isProxy: input.isProxy ?? false,
      isDatacenter: input.isDatacenter ?? false,
      asn: input.asn ?? null,
      org: input.org ?? null,
      isp: isp ?? null,
      deviceFingerprint: input.deviceFingerprint ?? null,
      history,
    });

    const riskEvidenceJson = serializeRiskEvidence(risk);

    // [DEBUG] Stage-3b: log exactly what is being written to DB
    logger.debug('[IP-AUDIT] Stage-3b writing to DB', {
      action:    input.action,
      ipAddress: input.ipAddress ?? 'NULL — will be stored as null',
      country,
      city,
    });

    const gpsCoords = sanitizeCoordinatePair(input.gpsLat, input.gpsLng);
    const ipCoords  = sanitizeCoordinatePair(ipLat, ipLng);

    await prisma.shareAccessLog.create({
      data: {
        shareLinkId:   input.shareLinkId,
        action:        input.action,
        recipientName: input.recipientName ?? null,
        ipAddress:     input.ipAddress ?? null,
        userAgent:     ua.slice(0, 500),
        browser:       input.browser ?? browser,
        os:            input.os ?? os,
        device:        finalDevice,
        country,
        city,
        region,
        isp,
        timezone:      input.timezone ?? null,
        referrer:      input.referrer ?? null,
        sessionId:     input.sessionId ?? null,
        screenResolution:  input.screenResolution ?? null,
        deviceFingerprint: input.deviceFingerprint ?? null,
        riskScore:     risk.score,
        riskLevel:     risk.level,
        riskFactors:   riskEvidenceJson,
        sessionDurationSec,
        gpsLat:        gpsCoords?.lat ?? null,
        gpsLng:        gpsCoords?.lng ?? null,
        gpsAccuracy:   input.gpsAccuracy   ?? null,
        gpsCity:       input.gpsCity       ?? null,
        gpsTimestamp:  input.gpsTimestamp  ?? null,
        locationShared:  input.locationShared ?? false,
        gpsVillage:      input.gpsVillage     ?? null,
        gpsMandal:       input.gpsMandal      ?? null,
        gpsDistrict:     input.gpsDistrict    ?? null,
        gpsState:        input.gpsState       ?? null,
        gpsPincode:      input.gpsPincode     ?? null,
        gpsFullAddress:  input.gpsFullAddress ?? null,
        locationSource:  gpsCoords
          ? (input.locationSource ?? 'gps')
          : ipCoords
            ? 'ip'
            : (input.locationSource ?? null),
        isVpn:         input.isVpn         ?? false,
        isTor:         input.isTor         ?? false,
        isProxy:       input.isProxy       ?? false,
        isDatacenter:  input.isDatacenter  ?? false,
        asn:           input.asn           ?? null,
        org:           input.org           ?? null,
        lat:           ipCoords?.lat ?? null,
        lng:           ipCoords?.lng ?? null,
        canvasFp:      input.canvasFp      ?? null,
        webglFp:       input.webglFp       ?? null,
        audioFp:       input.audioFp       ?? null,
      },
    });

    // ── Canonical asset timeline (Phase 2) ────────────────────────────────
    // A share view/download is asset activity, so it belongs on the Asset.id
    // timeline alongside listing and sale events. Only VIEWED and DOWNLOADED
    // map to timeline types; the attempt/forwarding actions stay in
    // ShareAccessLog, which is where the security detail lives.
    //
    // Location, IP, device fingerprint and risk data are deliberately NOT
    // forwarded — the creator reads this timeline in Asset 360 and must not
    // see a viewer's precise location or network identity.
    if (link.assetId && (input.action === 'VIEWED' || input.action === 'DOWNLOADED')) {
      import('../assets/asset-activity.service').then(({ recordAssetActivity }) => {
        recordAssetActivity({
          assetId: link.assetId,
          eventType: input.action === 'VIEWED' ? 'SHARE_VIEWED' : 'SHARE_DOWNLOADED',
          title: input.action === 'VIEWED' ? 'Shared link viewed' : 'Shared file downloaded',
          detail: link.filename ?? undefined,
          payload: {
            shareToken: link.token,
            linkType: link.linkType,
            sourceContext: link.sourceContext,
            country: country ?? null,
          },
        });
      }).catch(() => {});
    }

    // ── Platform events (notifications via Unified Event Engine) ───────────
    const NOTIFY_ACTIONS = new Set([
      'VIEWED', 'DOWNLOADED', 'FORWARDING_DETECTED',
      'COPY_ATTEMPT', 'SCREENSHOT_ATTEMPT', 'PRINT_ATTEMPT',
    ]);
    if (link.ownerUserId && NOTIFY_ACTIONS.has(input.action)) {
      const hopNumber = link.linkType === 'GRANDCHILD' ? 2 : link.linkType === 'CHILD' ? 1 : undefined;
      import('../platform-events/share-events').then(({ emitShareAccessEvent }) => {
        emitShareAccessEvent({
          ownerUserId: link.ownerUserId!,
          shareLinkId: link.id,
          token: link.token,
          filename: link.filename ?? 'File',
          dnaRecordId: link.dnaRecordId,
          vaultId: link.vaultId,
          action: input.action,
          ip: input.ipAddress,
          country,
          device: finalDevice,
          riskLevel: risk.level,
          riskScore: risk.score,
          riskFactors: risk.factors,
          locationSpoofSuspected: risk.locationInconsistent,
          trustScore: risk.trustScore,
          locationTrust: risk.locationTrust,
          alerts: risk.alerts,
          suggestedActions: risk.suggestedActions,
          hopNumber,
        });
      }).catch(() => {});
    }

    // Increment view/download counters; honor one-time-use & numeric download caps
    const updateData: Record<string, unknown> = {};
    if (input.action === 'VIEWED') {
      updateData['viewCount'] = { increment: 1 };
      // PARENT links stay open so WhatsApp forwards can mint hop URLs for new devices.
      // One-time-use only consumes leaf (CHILD / GRANDCHILD) links.
      if (link.oneTimeUse && link.linkType !== 'PARENT') {
        updateData['isActive'] = false;
        logger.info('[SmartLink] One-time-use link consumed — auto-revoking', { token: link.token });
      }
    }
    if (input.action === 'DOWNLOADED') {
      updateData['viewCount']      = { increment: 1 };
      updateData['downloadCount']  = { increment: 1 };
    }
    if (Object.keys(updateData).length > 0) {
      await prisma.shareLink.update({ where: { id: input.shareLinkId }, data: updateData });
    }

    if (risk.level === 'HIGH' || risk.level === 'CRITICAL') {
      logger.warn('[SmartLink] Elevated risk access detected', {
        token: link.token, action: input.action, score: risk.score, level: risk.level, factors: risk.factors,
      });
    }

    // ── Auto-revoke on CRITICAL risk ────────────────────────────────────────
    // Revokes the link automatically when score ≥ 85 AND at least 2 suspicious
    // actions exist in the history (guards against single-event false positives,
    // e.g. a first-time traveller triggering "+new country" alone).
    const SUSPICIOUS_ACTIONS = new Set(['COPY_ATTEMPT', 'SCREENSHOT_ATTEMPT', 'PRINT_ATTEMPT']);
    let autoRevoked = false;
    if (risk.level === 'CRITICAL' && risk.score >= 85) {
      const suspiciousCount = history.filter(h => SUSPICIOUS_ACTIONS.has(h.action)).length;
      if (suspiciousCount >= 2 || risk.score >= 90) {
        await prisma.shareLink.update({ where: { id: input.shareLinkId }, data: { isActive: false } });
        autoRevoked = true;
        logger.warn('[SmartLink] 🚨 AUTO-REVOKE triggered — CRITICAL risk with confirmed suspicious behaviour', {
          token: link.token, score: risk.score, suspiciousCount, factors: risk.factors,
        });
      }
    }

    const oneTimeConsumed = input.action === 'VIEWED' && link.oneTimeUse && link.linkType !== 'PARENT';
    if (link.ownerUserId && oneTimeConsumed) {
      import('../platform-events/extended-events').then(({ emitLinkOneTimeConsumed }) => {
        emitLinkOneTimeConsumed({
          ownerUserId: link.ownerUserId!,
          shareLinkId: link.id,
          token: link.token,
          filename: link.filename ?? 'File',
        });
      }).catch(() => {});
    }
    if (link.ownerUserId && autoRevoked) {
      import('../platform-events/share-events').then(({ emitShareLinkRevoked }) => {
        emitShareLinkRevoked(link.ownerUserId!, link.id, link.token, link.filename ?? 'File', {
          dnaRecordId: link.dnaRecordId,
          vaultId: link.vaultId,
        });
      }).catch(() => {});
    }

    logger.info('[SmartLink] Access logged', {
      token: link.token,
      action: input.action,
      ip: input.ipAddress,
      browser: input.browser ?? browser,
      country,
      riskScore: risk.score,
      riskLevel: risk.level,
    });
  }

  // ── Geo analytics aggregation (Geo Intelligence dashboard data) ───────────

  async getGeoAnalytics(dnaRecordId?: string, ownerUserId?: string) {
    const where = {
      ...(dnaRecordId ? { shareLink: { dnaRecordId } } : {}),
      ...(ownerUserId ? { shareLink: { ownerUserId } } : {}),
    };
    const logs = await prisma.shareAccessLog.findMany({
      where: { ...where, country: { not: null } },
      select: { country: true, city: true, action: true, riskLevel: true },
    });

    const byCountry: Record<string, { count: number; cities: Set<string>; highRisk: number }> = {};
    for (const log of logs) {
      const c = log.country!;
      byCountry[c] ??= { count: 0, cities: new Set(), highRisk: 0 };
      byCountry[c]!.count++;
      if (log.city) byCountry[c]!.cities.add(log.city);
      if (log.riskLevel === 'HIGH' || log.riskLevel === 'CRITICAL') byCountry[c]!.highRisk++;
    }

    return Object.entries(byCountry)
      .map(([country, v]) => ({
        country, accessCount: v.count, cities: [...v.cities], highRiskEvents: v.highRisk,
      }))
      .sort((a, b) => b.accessCount - a.accessCount);
  }

  /** Live map pins — where shared files were opened (GPS or IP geolocation). */
  async getLiveTrackingMap(ownerUserId: string) {
    const TRACKED_ACTIONS = [
      'VIEWED', 'DOWNLOADED', 'FORWARDING_DETECTED',
      'COPY_ATTEMPT', 'SCREENSHOT_ATTEMPT', 'PRINT_ATTEMPT',
    ];

    const logs = await prisma.shareAccessLog.findMany({
      where: {
        shareLink: { ownerUserId },
        action: { in: TRACKED_ACTIONS },
      },
      orderBy: { createdAt: 'desc' },
      take: 300,
      select: {
        id: true,
        action: true,
        createdAt: true,
        country: true,
        city: true,
        device: true,
        gpsLat: true,
        gpsLng: true,
        lat: true,
        lng: true,
        locationSource: true,
        shareLink: {
          select: { filename: true, vaultId: true, token: true },
        },
      },
    });

    const points: Array<{
      id: string;
      vaultId: string | null;
      filename: string;
      lat: number;
      lng: number;
      action: string;
      locationLabel: string;
      source: 'gps' | 'ip';
      timestamp: string;
      device: string | null;
    }> = [];

    for (const log of logs) {
      const gps = sanitizeCoordinatePair(log.gpsLat, log.gpsLng);
      const ip = sanitizeCoordinatePair(log.lat, log.lng);
      const coords = gps ?? ip;
      if (!coords) continue;

      const locationLabel = [log.city, log.country].filter(Boolean).join(', ')
        || `${coords.lat.toFixed(4)}, ${coords.lng.toFixed(4)}`;

      points.push({
        id: log.id,
        vaultId: log.shareLink.vaultId,
        filename: log.shareLink.filename ?? 'Shared file',
        lat: coords.lat,
        lng: coords.lng,
        action: log.action,
        locationLabel,
        source: gps ? 'gps' : 'ip',
        timestamp: log.createdAt.toISOString(),
        device: log.device,
      });
    }

    const oneHourAgo = Date.now() - 60 * 60 * 1000;
    const recentCount = points.filter(p => new Date(p.timestamp).getTime() > oneHourAgo).length;

    return {
      points,
      totalAccessPoints: points.length,
      recentAccessCount: recentCount,
      updatedAt: new Date().toISOString(),
    };
  }

  // ── CSV export of a link's full access log (Audit Export) ─────────────────

  async exportAccessLogsCsv(token: string): Promise<string | null> {
    const link = await this.getWithAggregatedLogs(token);
    if (!link) return null;

    const headers = [
      'Timestamp', 'Action', 'Recipient', 'IP Address', 'Country', 'City', 'Region', 'ISP',
      'Browser', 'OS', 'Device', 'Screen Resolution', 'Risk Score', 'Risk Level', 'Session Duration (s)', 'Session ID',
    ];
    const escape = (v: unknown) => {
      const s = v === null || v === undefined ? '' : String(v);
      return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
    };
    const rows = link.accessLogs.map(l => [
      l.createdAt.toISOString(), l.action, l.recipientName, l.ipAddress, l.country, l.city, l.region, l.isp,
      l.browser, l.os, l.device, l.screenResolution, l.riskScore, l.riskLevel, l.sessionDurationSec, l.sessionId,
    ].map(escape).join(','));

    return [headers.join(','), ...rows].join('\n');
  }

  // ── Get all links for a vault record ─────────────────────────────────────

  async listByVault(vaultId: string, ownerUserId: string) {
    const vault = await prisma.vaultRecord.findUnique({
      where: { id: vaultId },
      include: { dnaRecord: { select: { ownerUserId: true } } },
    });
    if (!vault) throw new Error(`Vault record not found: ${vaultId}`);
    assertRecordOwner(vault.dnaRecord?.ownerUserId, ownerUserId, 'Vault');

    // Explicit select rather than the whole row. The previous version returned
    // all 75 columns to the browser, including otpCodeHash and tokenSignature —
    // the OTP hash and the token's HMAC. The owner is entitled to their link,
    // but not to have its verification secrets shipped into a page where any
    // script or extension can read them.
    return prisma.shareLink.findMany({
      where:   { vaultId, ownerUserId, linkType: 'PARENT' },
      orderBy: { createdAt: 'desc' },
      select: {
        id: true, token: true, filename: true, mimeType: true, note: true,
        createdAt: true, expiresAt: true, isActive: true,
        maxViews: true, viewCount: true, maxDownloads: true, downloadCount: true,
        allowDownload: true, requireName: true, requestLocation: true,
        oneTimeUse: true, requireOtp: true, otpVerified: true,
        privacyMaskingEnabled: true, watermarkCode: true,
        forwardStatus: true, depth: true, linkType: true,
        recipientLabel: true, recipientEmail: true,
        reviewMode: true, allowComments: true, allowChangeRequest: true, allowApproval: true,
        accessLogs: {
          orderBy: { createdAt: 'desc' },
          take: 10,
          select: {
            id: true, createdAt: true, action: true,
            country: true, city: true, device: true, recipientName: true,
          },
        },
      },
    });
  }

  // ── List all share links (admin view) ─────────────────────────────────────
  // Only PARENT links belong here — hop CHILD/GRANDCHILD tokens are internal
  // forward tracking rows; listing them made every forward look "Revoked".

  async listAll(userId: string) {
    const links = await prisma.shareLink.findMany({
      where: {
        ownerUserId: userId,
        linkType: 'PARENT',
      },
      orderBy: { createdAt: 'desc' },
      include: {
        _count: { select: { accessLogs: true, childLinks: true } },
        accessLogs: { orderBy: { createdAt: 'desc' } },
      },
    });

    const healed: typeof links = [];
    for (const link of links) {
      const isExpired = !!link.expiresAt && new Date(link.expiresAt) < new Date();
      const isExhausted = !!link.maxViews && link.viewCount >= link.maxViews;
      const hopCount = link._count.childLinks;

      if (
        !link.isActive &&
        !isExpired &&
        !isExhausted &&
        (link.oneTimeUse || hopCount > 0)
      ) {
        const updated = await prisma.shareLink.update({
          where: { id: link.id },
          data: { isActive: true },
        });
        logger.info('[SmartLink] Reactivated parent link (legacy auto-revoke)', {
          token: link.token,
          oneTimeUse: link.oneTimeUse,
          hopCount,
        });
        healed.push({ ...link, ...updated, isActive: true });
      } else {
        healed.push(link);
      }
    }

    return healed;
  }

  // ── Get a specific link with full logs ────────────────────────────────────

  async getWithLogs(token: string) {
    const resolved = await findShareLinkByToken(token);
    if (!resolved) return null;
    const canonical = resolved.token;

    const baseInclude = {
      accessLogs: { orderBy: { createdAt: 'desc' as const } },
      _count: { select: { accessLogs: true } },
    };

    try {
      return await prisma.shareLink.findUnique({
        where: { token: canonical },
        include: {
          ...baseInclude,
          blockedViewers: { orderBy: { createdAt: 'desc' as const } },
        },
      });
    } catch (err) {
      // Graceful fallback if blocked_share_viewers table not yet migrated
      logger.warn('[SmartLink] getWithLogs fallback (no blockedViewers)', { token: canonical, error: String(err) });
      return prisma.shareLink.findUnique({
        where: { token: canonical },
        include: baseInclude,
      });
    }
  }

  /**
   * Parent + entire hop tree — Access Intelligence must show every forwarded recipient,
   * not only people who hit the original URL (their VIEWED logs live on hop tokens).
   */
  async getWithAggregatedLogs(token: string) {
    const resolved = await findShareLinkByToken(token);
    if (!resolved) return null;

    let root = resolved;
    while (root.parentLinkId) {
      const parent = await prisma.shareLink.findUnique({ where: { id: root.parentLinkId } });
      if (!parent) break;
      root = parent;
    }

    const descendantIds = await this.getShareLinkDescendantIds(root.id);
    const allIds = [root.id, ...descendantIds];

    const accessLogsRaw = await prisma.shareAccessLog.findMany({
      where: { shareLinkId: { in: allIds } },
      orderBy: { createdAt: 'desc' },
      include: {
        shareLink: {
          select: { id: true, token: true, linkType: true, depth: true, parentLinkId: true },
        },
      },
    });

    // Flatten hop metadata onto each log so Access Intelligence can color
    // Direct Recipient (green) / Direct Share (blue) / Reshared (red).
    const accessLogs = accessLogsRaw.map((log) => {
      const { shareLink: hopLink, ...rest } = log;
      const linkType = hopLink?.linkType ?? 'PARENT';
      const linkDepth = hopLink?.depth ?? 0;
      const isReshareLink = linkType !== 'PARENT' || linkDepth > 0 || hopLink?.id !== root.id;
      return {
        ...rest,
        shareLinkId: hopLink?.id ?? rest.shareLinkId,
        linkType,
        linkDepth,
        isReshareLink,
        hopToken: hopLink?.token ?? null,
      };
    });

    const baseInclude = {
      _count: { select: { accessLogs: true } },
    };

    let rootLink;
    try {
      rootLink = await prisma.shareLink.findUnique({
        where: { id: root.id },
        include: {
          ...baseInclude,
          blockedViewers: { orderBy: { createdAt: 'desc' as const } },
        },
      });
    } catch (err) {
      logger.warn('[SmartLink] getWithAggregatedLogs fallback (no blockedViewers)', {
        token: root.token,
        error: String(err),
      });
      rootLink = await prisma.shareLink.findUnique({
        where: { id: root.id },
        include: baseInclude,
      });
    }

    if (!rootLink) return null;

    const viewCount = accessLogs.filter(l => l.action === 'VIEWED').length;
    const downloadCount = accessLogs.filter(l => l.action === 'DOWNLOADED').length;

    logger.debug('[SmartLink] Aggregated access logs', {
      rootToken: root.token,
      hopLinks: descendantIds.length,
      logRows: accessLogs.length,
      uniqueViewersApprox: new Set(
        accessLogs
          .filter(l => l.action === 'VIEWED' || l.action === 'FORWARDING_DETECTED')
          .map(l => l.deviceFingerprint ?? `${l.ipAddress}|${l.sessionId}`),
      ).size,
    });

    return {
      ...rootLink,
      accessLogs,
      viewCount,
      downloadCount,
      hopLinkCount: descendantIds.length,
    };
  }

  // ── Per-viewer block / revoke ─────────────────────────────────────────────

  /**
   * Match blocks precisely:
   * - If a block has a deviceFingerprint → ONLY that device (same Wi‑Fi IP must not revoke others)
   * - Else if sessionId → that session only
   * - Else IP-only blocks (last resort when fingerprint was missing)
   */
  async isViewerBlocked(
    shareLinkId: string,
    viewer: { deviceFingerprint?: string | null; sessionId?: string | null; ipAddress?: string | null },
  ): Promise<boolean> {
    const ancestryIds = await this.getShareLinkAncestryIds(shareLinkId);
    const blocks = await prisma.blockedShareViewer.findMany({
      where: { shareLinkId: { in: ancestryIds } },
    });
    if (!blocks.length) return false;
    return blocks.some((b) => {
      if (b.deviceFingerprint) {
        return Boolean(viewer.deviceFingerprint && b.deviceFingerprint === viewer.deviceFingerprint);
      }
      if (b.sessionId) {
        return Boolean(viewer.sessionId && b.sessionId === viewer.sessionId);
      }
      if (b.ipAddress) {
        return Boolean(viewer.ipAddress && b.ipAddress === viewer.ipAddress);
      }
      return false;
    });
  }

  async blockViewer(
    token: string,
    ownerUserId: string,
    input: { deviceFingerprint?: string; sessionId?: string; ipAddress?: string; label?: string; reason?: string },
  ) {
    const link = await prisma.shareLink.findUnique({ where: { token } });
    if (!link) throw new Error(`Share link not found: ${token}`);
    if (link.ownerUserId && link.ownerUserId !== ownerUserId) {
      throw new Error('Unauthorized — you do not own this share link');
    }

    // Prefer device fingerprint so home Wi‑Fi (shared public IP) does not
    // revoke every phone/laptop on the same network.
    const hasFp = Boolean(input.deviceFingerprint?.trim());
    const ancestryIds = await this.getShareLinkAncestryIds(link.id);
    const rootShareLinkId = ancestryIds[ancestryIds.length - 1] ?? link.id;
    const block = await prisma.blockedShareViewer.create({
      data: {
        shareLinkId: rootShareLinkId,
        deviceFingerprint: hasFp ? input.deviceFingerprint!.trim() : null,
        sessionId: hasFp ? null : (input.sessionId ?? null),
        ipAddress: hasFp ? null : (input.ipAddress ?? null),
        label: input.label ?? null,
        reason: input.reason ?? 'Revoked by owner',
        blockedByUserId: ownerUserId,
      },
    });

    logger.info('[SmartLink] Viewer blocked', {
      token,
      scope: hasFp ? 'device' : input.sessionId ? 'session' : 'ip',
      deviceFingerprint: input.deviceFingerprint?.slice(0, 12),
      sessionId: input.sessionId?.slice(0, 12),
      ipAddress: hasFp ? undefined : input.ipAddress,
    });

    return block;
  }

  async unblockViewer(token: string, ownerUserId: string, blockId: string) {
    const link = await prisma.shareLink.findUnique({ where: { token } });
    if (!link) throw new Error(`Share link not found: ${token}`);
    if (link.ownerUserId && link.ownerUserId !== ownerUserId) {
      throw new Error('Unauthorized — you do not own this share link');
    }

    await prisma.blockedShareViewer.deleteMany({
      where: { id: blockId, shareLinkId: link.id },
    });

    return { ok: true };
  }

  // ── Revoke ────────────────────────────────────────────────────────────────

  async revoke(token: string, ownerUserId: string) {
    const link = await prisma.shareLink.findUnique({ where: { token } });
    if (!link) throw new Error(`Share link not found: ${token}`);
    assertRecordOwner(link.ownerUserId, ownerUserId, 'Share link');

    await prisma.shareLink.update({
      where: { token },
      data:  { isActive: false },
    });

    import('../platform-events/share-events').then(({ emitShareLinkRevoked }) => {
      emitShareLinkRevoked(ownerUserId, link.id, link.token, link.filename ?? 'File', {
        dnaRecordId: link.dnaRecordId,
        vaultId: link.vaultId,
      });
    }).catch(() => {});

    logger.info('[SmartLink] Revoked', { token, filename: link.filename });
    return link;
  }

  // ── Live / concurrent session monitoring ──────────────────────────────────
  // A "live session" = a distinct sessionId with an event in the last 5 minutes.
  // "Force logout" maps to revoking the parent link — the next request from
  // that session is blocked server-side immediately (see recordAccess/serveSharedFile).

  async getLiveSessions(ownerUserId: string) {
    const cutoff = new Date(Date.now() - 5 * 60_000);
    const recent = await prisma.shareAccessLog.findMany({
      where:   { sessionId: { not: null }, createdAt: { gte: cutoff }, shareLink: { ownerUserId } },
      orderBy: { createdAt: 'desc' },
      include: { shareLink: { select: { token: true, filename: true, dnaRecordId: true, isActive: true } } },
    });

    const bySession = new Map<string, typeof recent>();
    for (const log of recent) {
      const key = log.sessionId!;
      if (!bySession.has(key)) bySession.set(key, []);
      bySession.get(key)!.push(log);
    }

    const sessions = [...bySession.entries()].map(([sessionId, logs]) => {
      const latest = logs[0]!;
      const oldest = logs[logs.length - 1]!;
      const riskLevels = logs.map(l => l.riskLevel).filter(Boolean);
      const worstRisk = ['CRITICAL', 'HIGH', 'MEDIUM', 'LOW'].find(lv => riskLevels.includes(lv)) ?? 'LOW';
      return {
        sessionId,
        token:        latest.shareLink.token,
        filename:     latest.shareLink.filename,
        dnaRecordId:  latest.shareLink.dnaRecordId,
        linkActive:   latest.shareLink.isActive,
        recipientName: latest.recipientName,
        ipAddress:    latest.ipAddress,
        country:      latest.country,
        city:         latest.city,
        browser:      latest.browser,
        os:           latest.os,
        device:       latest.device,
        eventCount:   logs.length,
        firstSeen:    oldest.createdAt,
        lastSeen:     latest.createdAt,
        durationSec:  Math.round((latest.createdAt.getTime() - oldest.createdAt.getTime()) / 1000),
        riskLevel:    worstRisk,
        lastAction:   latest.action,
      };
    }).sort((a, b) => b.lastSeen.getTime() - a.lastSeen.getTime());

    // Concurrent-session detection: same link, multiple distinct active sessions
    const byToken = new Map<string, number>();
    for (const s of sessions) byToken.set(s.token, (byToken.get(s.token) ?? 0) + 1);
    const concurrentTokens = [...byToken.entries()].filter(([, n]) => n > 1).map(([t]) => t);

    return { sessions, concurrentTokens };
  }

  // ── Get access logs for File Timeline ────────────────────────────────────

  async getTimelineEvents(dnaRecordId: string, ownerUserId: string) {
    const dna = await prisma.dnaRecord.findUnique({
      where: { id: dnaRecordId },
      select: { ownerUserId: true },
    });
    if (!dna) throw new Error(`DNA record not found: ${dnaRecordId}`);
    assertRecordOwner(dna.ownerUserId, ownerUserId, 'DNA record');

    const links = await prisma.shareLink.findMany({
      where:   { dnaRecordId, ownerUserId },
      orderBy: { createdAt: 'asc' },
      include: { accessLogs: { orderBy: { createdAt: 'asc' } } },
    });
    return links;
  }
}

export const shareLinkService = new ShareLinkService();
