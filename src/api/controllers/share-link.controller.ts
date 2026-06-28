/**
 * PINIT-DNA — Smart Links Controller
 *
 * POST   /api/v1/share                    — Create share link
 * GET    /api/v1/share                    — List all share links
 * GET    /api/v1/share/:token             — Get link info (public, no auth)
 * GET    /api/v1/share/:token/logs        — Get full access logs
 * POST   /api/v1/share/:token/access      — Record access event (called by viewer page)
 * DELETE /api/v1/share/:token             — Revoke link
 * GET    /api/v1/share/vault/:vaultId     — Get links for a vault record
 * GET    /api/v1/share/timeline/:dnaId    — Get share events for timeline
 */

import { Request, Response, NextFunction } from 'express';
import { shareLinkService, geoFromIp } from '../../services/share/share-link.service';
import { getIpIntelligence } from '../../services/forensic/ip-intelligence.service';
import { detectForwardingForLink } from '../../services/forensic/forward-detection.engine';
import { tepService } from '../../services/tep/tep.service';
import { getOrCreateRecipient } from '../../services/watermark/watermark.service';
import { VaultService }     from '../../services/vault/vault.service';
import { logger }           from '../../lib/logger';
import { prisma }           from '../../lib/prisma';
import { auditService }     from '../../services/audit/audit.service';
import { resolveClientIp, buildShareUrl, dumpIpHeaders, resolvePublicBaseUrl } from '../../lib/request-utils';
import { sanitizeCoordinatePair } from '../../lib/geo-coords';
import { getAuthUserId } from '../../lib/tenant-scope';

/** Parse GPS + address fields from share access POST body. */
function parseAccessGps(body: Record<string, unknown>) {
  const b = body as {
    gpsLat?: number; gpsLng?: number; gpsAccuracy?: number;
    gpsCity?: string; gpsTimestamp?: string;
    gpsVillage?: string; gpsMandal?: string; gpsDistrict?: string;
    gpsState?: string; gpsPincode?: string; gpsFullAddress?: string;
    locationShared?: boolean; locationSource?: string;
  };
  return {
    gpsLat:        b.gpsLat ?? undefined,
    gpsLng:        b.gpsLng ?? undefined,
    gpsAccuracy:   b.gpsAccuracy ?? undefined,
    gpsCity:       b.gpsCity ?? undefined,
    gpsTimestamp:  b.gpsTimestamp ? new Date(b.gpsTimestamp) : undefined,
    gpsVillage:    b.gpsVillage ?? undefined,
    gpsMandal:     b.gpsMandal ?? undefined,
    gpsDistrict:   b.gpsDistrict ?? undefined,
    gpsState:      b.gpsState ?? undefined,
    gpsPincode:    b.gpsPincode ?? undefined,
    gpsFullAddress: b.gpsFullAddress ?? undefined,
    locationShared: b.locationShared ?? false,
    locationSource: b.locationSource ?? undefined,
  };
}

function accessBodyFields(body: Record<string, unknown>) {
  const b = body as {
    action?: string; recipientName?: string; timezone?: string; sessionId?: string;
    scrollDepth?: string; screenResolution?: string; deviceFingerprint?: string;
  };
  return {
    action: b.action,
    recipientName: b.recipientName,
    timezone: b.timezone,
    sessionId: b.sessionId,
    screenResolution: b.screenResolution,
    deviceFingerprint: b.deviceFingerprint,
    ...parseAccessGps(body),
  };
}
import {
  applyMasks,
  extractTextFromPdf,
  extractTextFromDocx,
  extractTextFromPlain,
  MaskingConfig,
} from '../../services/privacy/privacy-masking.service';

const vaultService = new VaultService();

// ── UA parse helpers ──────────────────────────────────────────────────────────
function parseUaBrowser(ua: string): string {
  return /Edg\//.test(ua) ? 'Edge' : /Chrome\//.test(ua) ? 'Chrome' :
    /Firefox\//.test(ua) ? 'Firefox' : /Safari\//.test(ua) ? 'Safari' : 'Unknown';
}
function parseUaOs(ua: string): string {
  return /Windows/.test(ua) ? 'Windows' : /Mac OS/.test(ua) ? 'macOS' :
    /Android/.test(ua) ? 'Android' : /iPhone|iPad/.test(ua) ? 'iOS' :
    /Linux/.test(ua) ? 'Linux' : 'Unknown';
}

// ── Create share link ─────────────────────────────────────────────────────────

export async function createShareLink(req: Request, res: Response, next: NextFunction): Promise<void> {
  try {
    const {
      vaultId, expiresIn, maxViews, allowDownload, requireName, note,
      oneTimeUse, maxDownloads, allowedCountries, allowedDeviceTypes, allowedIpPrefixes,
      requireOtp, recipientEmail,
      privacyMaskingEnabled, maskEmail, maskPhone, maskAadhaar, maskPan, maskAddress, maskCustomPatterns,
      requestLocation,
    } = req.body as {
      vaultId: string;
      expiresIn?: number | null;
      maxViews?: number | null;
      allowDownload?: boolean;
      requireName?: boolean;
      note?: string;
      oneTimeUse?: boolean;
      maxDownloads?: number | null;
      allowedCountries?: string[];
      allowedDeviceTypes?: string[];
      allowedIpPrefixes?: string[];
      requireOtp?: boolean;
      recipientEmail?: string;
      privacyMaskingEnabled?: boolean;
      maskEmail?: boolean;
      maskPhone?: boolean;
      maskAadhaar?: boolean;
      maskPan?: boolean;
      maskAddress?: boolean;
      maskCustomPatterns?: string[];
      requestLocation?: boolean;
    };

    if (!vaultId) { res.status(400).json({ success: false, error: 'vaultId is required' }); return; }

    const ownerUserId = getAuthUserId(req);
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const recipients = (req.body as any).recipients as Array<{ label: string; email?: string }> | undefined;

    const { devOtp, childLinks, ...link } = await shareLinkService.create({
      vaultId, expiresIn, maxViews, allowDownload, requireName, note,
      oneTimeUse, maxDownloads, allowedCountries, allowedDeviceTypes, allowedIpPrefixes,
      requireOtp, recipientEmail,
      privacyMaskingEnabled, maskEmail, maskPhone, maskAadhaar, maskPan, maskAddress, maskCustomPatterns,
      requestLocation,
      ownerUserId,
      recipients,
    }) as any;

    const shareUrl = buildShareUrl(req, link.token);
    logger.info('[SmartLink] Share URL generated', { shareUrl, token: link.token });

    // Build child link URLs
    const appUrl = process.env['PUBLIC_APP_URL'] ?? `${req.protocol}://${req.get('host')}`;
    const childLinkUrls = (childLinks ?? []).map((c: any) => ({
      ...c,
      url: `${appUrl}/s/${c.token}`,
    }));

    res.status(201).json({
      success: true,
      shareUrl,
      token: link.token,
      link,
      childLinks: childLinkUrls,
      ...(devOtp ? { devOtp, devOtpNote: 'No SMTP configured — share this code with the recipient manually for the demo.' } : {}),
    });
  } catch (err) { next(err); }
}

// ── List all links ────────────────────────────────────────────────────────────

export async function listShareLinks(req: Request, res: Response, next: NextFunction): Promise<void> {
  try {
    const userId = getAuthUserId(req);
    const links = await shareLinkService.listAll(userId);
    res.json({ success: true, count: links.length, links });
  } catch (err) { next(err); }
}

// ── Get link info (public — called by /s/:token page) ─────────────────────────

export async function getShareLinkInfo(req: Request, res: Response, next: NextFunction): Promise<void> {
  try {
    const info = await shareLinkService.getPublicInfo(req.params['token']!);
    if (!info) { res.status(404).json({ success: false, error: 'Link not found' }); return; }
    res.json({ success: true, link: info });
  } catch (err) { next(err); }
}

// ── Get logs for a token ──────────────────────────────────────────────────────

export async function getShareLinkLogs(req: Request, res: Response, next: NextFunction): Promise<void> {
  try {
    const token = req.params['token']!;
    const ownerUserId = (req as { user?: { sub?: string } }).user?.sub;

    const link = await shareLinkService.getWithLogs(token);
    if (!link) {
      res.status(404).json({ success: false, error: 'Link not found' });
      return;
    }

    if (link.ownerUserId && ownerUserId && link.ownerUserId !== ownerUserId) {
      res.status(403).json({ success: false, error: 'You do not have access to this link' });
      return;
    }

    const sample = link.accessLogs.slice(0, 5).map(l => ({ action: l.action, ipAddress: l.ipAddress ?? 'NULL', createdAt: l.createdAt }));
    logger.debug('[IP-AUDIT] Stage-4 getShareLinkLogs returning', { token, sample });

    res.json({ success: true, link });
  } catch (err) { next(err); }
}

// ── Record access event ───────────────────────────────────────────────────────

export async function recordAccess(req: Request, res: Response, next: NextFunction): Promise<void> {
  try {
    const token = req.params['token']!;
    const body = req.body as Record<string, unknown>;
    const {
      action, recipientName, timezone, sessionId, screenResolution, deviceFingerprint,
    } = accessBodyFields(body);
    const gpsFields = parseAccessGps(body);

    const link = await shareLinkService.getPublicInfo(token);
    if (!link) { res.status(404).json({ success: false, error: 'Link not found' }); return; }

    const realIp = resolveClientIp(req);
    logger.debug('[IP-AUDIT] Stage-2 recordAccess', { token, action, ...dumpIpHeaders(req) });

    const SECURITY_EVENTS = new Set([
      'COPY_ATTEMPT', 'SCREENSHOT_ATTEMPT', 'PRINT_ATTEMPT',
      'TAB_SWITCH', 'SCROLL', 'IDLE', 'ACTIVE',
    ]);
    const isSecurityEvent = SECURITY_EVENTS.has(action ?? '');

    const fullLinkEarly = await shareLinkService.getWithLogs(token);
    if (fullLinkEarly && await shareLinkService.isViewerBlocked(fullLinkEarly.id, {
      deviceFingerprint, sessionId, ipAddress: realIp,
    })) {
      await shareLinkService.recordAccess({
        shareLinkId: fullLinkEarly.id,
        action: 'BLOCKED_REVOKED',
        ipAddress: realIp,
        userAgent: req.headers['user-agent'],
        referrer: req.headers['referer'],
        timezone, sessionId, screenResolution, deviceFingerprint,
        ...gpsFields,
      });
      if (!isSecurityEvent) {
        res.status(403).json({
          success: false,
          error: 'Your access to this link has been revoked by the owner',
          blocked: true,
          viewerRevoked: true,
        });
        return;
      }
    }

    // Block access if expired, exhausted, or signature invalid (tampered token)
    // — BUT let security/behaviour events through regardless
    if (!link.isActive && !isSecurityEvent) {
      const blockAction = !link.signatureValid ? 'BLOCKED_TAMPERED'
        : link.isExpired ? 'BLOCKED_EXPIRED' : 'BLOCKED_MAX_VIEWS';
      await shareLinkService.recordAccess({
        shareLinkId: (await shareLinkService.getWithLogs(token))!.id,
        action: blockAction,
        ipAddress: realIp,
        userAgent: req.headers['user-agent'],
        referrer:  req.headers['referer'],
        timezone, sessionId, screenResolution, deviceFingerprint,
        ...gpsFields,
      });
      res.status(403).json({
        success: false,
        error: !link.signatureValid ? 'Link signature invalid — possible tampering detected'
          : link.isExpired ? 'Link has expired' : 'Maximum views reached',
        blocked: true,
      });
      return;
    }

    const fullLink = await shareLinkService.getWithLogs(token);
    if (!fullLink) { res.status(404).json({ success: false, error: 'Link not found' }); return; }

    // ── Identity verification gate: OTP must be verified before any tracked
    //    access (other than the OTP verification call itself) is recorded.
    //    Security events are allowed through — if someone is on the viewer page
    //    they got past the gate already; don't block forensic events.
    if (link.requireOtp && !link.otpVerified && !isSecurityEvent) {
      res.status(403).json({ success: false, error: 'OTP verification required', blocked: true, requiresOtp: true });
      return;
    }

    // ── Policy enforcement: device / geo / IP allow-lists ─────────────────
    // Resolve geo + device for policy check (best-effort; cheap repeat call,
    // recordAccess will geolocate again for the persisted log — acceptable
    // duplication for correctness given ip-api.com has no auth/cost).
    const ua = req.headers['user-agent'] as string ?? '';
    const deviceGuess = /Mobi|Android/.test(ua) ? 'mobile' : /Tablet|iPad/.test(ua) ? 'tablet' : 'desktop';
    let geoCountry: string | null = null;
    if (fullLink.allowedCountries?.length && realIp) {
      const geo = await geoFromIp(realIp);
      geoCountry = geo.country ?? null;
    }
    const policyCheck = shareLinkService.checkPolicy(fullLink, {
      country: geoCountry, device: deviceGuess, ipAddress: realIp,
    });
    if (!policyCheck.allowed && !isSecurityEvent) {
      await shareLinkService.recordAccess({
        shareLinkId: fullLink.id,
        action: 'BLOCKED_POLICY',
        ipAddress: realIp,
        userAgent: ua,
        referrer:  req.headers['referer'],
        timezone, sessionId, screenResolution, deviceFingerprint,
        ...gpsFields,
      });
      res.status(403).json({ success: false, error: policyCheck.message, blocked: true, reason: policyCheck.reason });
      return;
    }

    // ── IP Intelligence (forensic) ────────────────────────────────────────
    const ipIntel = realIp ? await getIpIntelligence(realIp) : null;

    // ── Enterprise security controls (vpnBlock, torBlock) ────────────────
    if (!isSecurityEvent && ipIntel) {
      if ((fullLink as any).torBlock && ipIntel.isTor) {
        await shareLinkService.recordAccess({ shareLinkId: fullLink.id, action: 'BLOCKED_TOR', ipAddress: realIp, userAgent: req.headers['user-agent'], sessionId, isTor: true, isProxy: true });
        res.status(403).json({ success: false, error: 'TOR access is not permitted for this link', blocked: true });
        return;
      }
      if ((fullLink as any).vpnBlock && ipIntel.isVpn) {
        await shareLinkService.recordAccess({ shareLinkId: fullLink.id, action: 'BLOCKED_VPN', ipAddress: realIp, userAgent: req.headers['user-agent'], sessionId, isVpn: true });
        res.status(403).json({ success: false, error: 'VPN access is not permitted for this link', blocked: true });
        return;
      }
    }

    // ── Forwarding detection for CHILD / GRANDCHILD links ────────────────
    let forwardingDetected = false;
    let grandchildToken: string | undefined;
    if (fullLink.linkType !== 'PARENT' && (action === 'VIEWED' || !action) && realIp) {
      const fwdVerdict = await detectForwardingForLink(fullLink.id, realIp, deviceFingerprint, ipIntel ?? { ip: realIp, country: '', countryCode: '', city: '', region: '', isp: '', org: '', asn: '', timezone: '', lat: 0, lng: 0, isVpn: false, isTor: false, isProxy: false, isDatacenter: false, abuseScore: 0 });
      forwardingDetected = fwdVerdict.status !== 'CLEAN';
      if (forwardingDetected) {
        logger.warn('[SmartLink] Forwarding detected', { token, score: fwdVerdict.score, status: fwdVerdict.status, reasons: fwdVerdict.reasons });
      }
      // Also run old detectForwarding for grandchild link creation
      const geo = await geoFromIp(realIp);
      const fwdResult = await shareLinkService.detectForwarding(fullLink as any, realIp, deviceFingerprint ?? null, { country: geo.country, city: geo.city, browser: parseUaBrowser(req.headers['user-agent'] ?? ''), os: parseUaOs(req.headers['user-agent'] ?? '') });
      grandchildToken = fwdResult.grandchildToken;
    }

    const ipCoords = ipIntel ? sanitizeCoordinatePair(ipIntel.lat, ipIntel.lng) : null;

    await shareLinkService.recordAccess({
      shareLinkId:  fullLink.id,
      action:       forwardingDetected ? 'FORWARDING_DETECTED' : (action ?? 'VIEWED'),
      recipientName,
      ipAddress:    realIp,
      userAgent:    req.headers['user-agent'],
      referrer:     req.headers['referer'],
      timezone, sessionId, screenResolution, deviceFingerprint,
      ...gpsFields,
      isVpn:        ipIntel?.isVpn ?? false,
      isTor:        ipIntel?.isTor ?? false,
      isProxy:      ipIntel?.isProxy ?? false,
      isDatacenter: ipIntel?.isDatacenter ?? false,
      asn:          ipIntel?.asn,
      org:          ipIntel?.org,
      lat:          ipCoords?.lat,
      lng:          ipCoords?.lng,
    });

    logger.info('[SmartLink] Access recorded', { token, action, ip: realIp });
    res.json({ success: true, link, forwardingDetected, ...(grandchildToken ? { grandchildToken } : {}) });
  } catch (err) { next(err); }
}

// ── Verify OTP code entered by recipient ──────────────────────────────────────

export async function verifyShareOtp(req: Request, res: Response, next: NextFunction): Promise<void> {
  try {
    const token = req.params['token']!;
    const { otp } = req.body as { otp?: string };
    if (!otp) { res.status(400).json({ success: false, error: 'OTP code is required' }); return; }

    const result = await shareLinkService.verifyOtp(token, otp);
    if (!result.ok) { res.status(400).json({ success: false, error: result.message }); return; }
    res.json({ success: true, message: result.message });
  } catch (err) { next(err); }
}

// ── Geo analytics aggregation ──────────────────────────────────────────────────

export async function getGeoAnalytics(req: Request, res: Response, next: NextFunction): Promise<void> {
  try {
    const ownerUserId = (req as any).user?.sub;
    const dnaRecordId = req.query['dnaRecordId'] as string | undefined;
    const analytics = await shareLinkService.getGeoAnalytics(dnaRecordId, ownerUserId);
    res.json({ success: true, analytics });
  } catch (err) { next(err); }
}

// ── CSV audit export ────────────────────────────────────────────────────────────

export async function exportShareLogsCsv(req: Request, res: Response, next: NextFunction): Promise<void> {
  try {
    const token = req.params['token']!;
    const csv = await shareLinkService.exportAccessLogsCsv(token);
    if (csv === null) { res.status(404).json({ success: false, error: 'Link not found' }); return; }

    res.set({
      'Content-Type': 'text/csv',
      'Content-Disposition': `attachment; filename="share-audit-${token}.csv"`,
    });
    res.send(csv);
  } catch (err) { next(err); }
}

// ── Live / concurrent session monitoring ───────────────────────────────────────

export async function getLiveSessions(req: Request, res: Response, next: NextFunction): Promise<void> {
  try {
    const ownerUserId = getAuthUserId(req);
    const data = await shareLinkService.getLiveSessions(ownerUserId);
    res.json({ success: true, ...data });
  } catch (err) { next(err); }
}

// ── Force logout (= revoke link → next request from any session is blocked) ────

export async function forceLogoutLink(req: Request, res: Response, next: NextFunction): Promise<void> {
  try {
    const ownerUserId = getAuthUserId(req);
    const link = await shareLinkService.revoke(req.params['token']!, ownerUserId);
    logger.info('[SmartLink] Force logout — link revoked', { token: link.token });
    res.json({ success: true, message: 'All active sessions for this link have been terminated', token: link.token });
  } catch (err) { next(err); }
}

// ── Serve the actual file via share link ──────────────────────────────────────
// ALL restrictions enforced here — this is the single file-serving gate.

export async function serveSharedFile(req: Request, res: Response, next: NextFunction): Promise<void> {
  try {
    const token = req.params['token']!;
    const info  = await shareLinkService.getPublicInfo(token);

    if (!info || !info.isActive) {
      res.status(403).json({ success: false, error: 'Link is inactive, expired, or exhausted' });
      return;
    }

    // OTP gate — file must not be served until the recipient verifies their code
    if (info.requireOtp && !info.otpVerified) {
      res.status(403).json({ success: false, error: 'OTP verification required', requiresOtp: true });
      return;
    }

    const fullLink = await shareLinkService.getWithLogs(token);
    if (!fullLink) { res.status(404).json({ success: false, error: 'Link not found' }); return; }

    const realIp = resolveClientIp(req);
    const sessionId = (req.headers['x-pinit-session'] as string | undefined) ?? undefined;
    const deviceFingerprint = (req.headers['x-pinit-fingerprint'] as string | undefined) ?? undefined;

    if (await shareLinkService.isViewerBlocked(fullLink.id, { deviceFingerprint, sessionId, ipAddress: realIp })) {
      res.status(403).json({
        success: false,
        error: 'Your access to this link has been revoked by the owner',
        blocked: true,
        viewerRevoked: true,
      });
      return;
    }

    // ── Policy enforcement: device / geo / IP allow-lists ─────────────────────
    logger.debug('[IP-AUDIT] Stage-2 serveSharedFile', { token, ...dumpIpHeaders(req) });

    const ua = req.headers['user-agent'] as string ?? '';
    const deviceGuess = /Mobi|Android/.test(ua) ? 'mobile' : /Tablet|iPad/.test(ua) ? 'tablet' : 'desktop';
    let geoCountry: string | null = null;
    if (fullLink.allowedCountries?.length && realIp) {
      const geo = await geoFromIp(realIp);
      geoCountry = geo.country ?? null;
    }
    const policyCheck = shareLinkService.checkPolicy(fullLink, { country: geoCountry, device: deviceGuess, ipAddress: realIp });
    if (!policyCheck.allowed) {
      res.status(403).json({ success: false, error: policyCheck.message, blocked: true });
      return;
    }

    // ── Signature / tamper check ──────────────────────────────────────────────
    if (!info.signatureValid) {
      res.status(403).json({ success: false, error: 'Link signature invalid — possible tampering detected' });
      return;
    }

    // ── maxDownloads enforcement ───────────────────────────────────────────────
    if (fullLink.maxDownloads != null && fullLink.downloadCount >= fullLink.maxDownloads) {
      res.status(403).json({ success: false, error: 'Maximum downloads reached for this link', blocked: true });
      return;
    }

    // Audit file delivery — client POST /access records the tracked VIEWED event with GPS
    await shareLinkService.recordAccess({
      shareLinkId: fullLink.id,
      action:      'FILE_SERVED',
      ipAddress:   realIp,
      userAgent:   req.headers['user-agent'],
      referrer:    req.headers['referer'],
      sessionId,
      deviceFingerprint,
    });

    // Retrieve decrypted file from vault and stream it
    const result = await vaultService.retrieve(fullLink.vaultId);

    // ── File tamper check: re-hash decrypted buffer and compare with stored DNA hash ──
    const tamperResult = await shareLinkService.checkFileTamper(
      fullLink.dnaRecordId, fullLink.vaultId, result.originalBuffer,
      token, realIp ?? undefined,
      req.headers['user-agent'] ?? undefined
    );
    if (tamperResult.tampered) {
      // Hash mismatch is expected when identity embedding is active (modifies file before encryption).
      // Log for forensic audit but do NOT block file serving.
      logger.warn('[TamperDetection] Hash mismatch — likely identity-embedded file', { token, vaultId: fullLink.vaultId });
    }

    // ── Content-Disposition: inline (view in browser) vs attachment (force download)
    // When allowDownload=false, serve inline only — no download header.
    // When allowDownload=true, serve as attachment so browser triggers save dialog.
    const disposition = fullLink.allowDownload
      ? `attachment; filename="${fullLink.filename}"`
      : `inline; filename="${fullLink.filename}"`;

    res.set({
      'Content-Type':        fullLink.mimeType,
      'Content-Disposition': disposition,
      'X-Share-Token':       token,
      'Cache-Control':       'no-store',
      // Prevent browser from caching — ensures policy checks run every time
      'Pragma':              'no-cache',
      'Expires':             '0',
    });
    // ── TEP v3.0 — Tracked Export Package (per-recipient forensic attribution) ─
    let fileBuffer = result.originalBuffer;
    try {
      const fingerprint = req.headers['x-device-fingerprint'] as string | undefined
        ?? req.headers['x-fingerprint'] as string | undefined;
      const { id: recipientId } = await getOrCreateRecipient({
        fingerprint,
        country: (req as any).geoCountry ?? undefined,
        device:  req.headers['user-agent'],
        ipAddress: realIp,
      });

      const geo = realIp ? await geoFromIp(realIp) : null;
      const tep = await tepService.createTrackedExport({
        fileBuffer:    result.originalBuffer,
        mimeType:      fullLink.mimeType,
        filename:      fullLink.filename,
        dnaRecordId:   fullLink.dnaRecordId,
        vaultId:       fullLink.vaultId,
        shareLinkId:   fullLink.id,
        recipientId,
        sessionToken:  req.headers['x-session-id'] as string | undefined,
        recipientEmail: fullLink.recipientEmail ?? undefined,
        ipAddress:     realIp ?? undefined,
        geoCountry:    geo?.country ?? undefined,
        geoCity:       geo?.city ?? undefined,
        deviceContext: req.headers['user-agent'] as string | undefined,
        ownerUserId:   fullLink.ownerUserId ?? undefined,
      });
      fileBuffer = tep.buffer;
      res.set('X-TEP-Code', tep.tepCode);
    } catch (tepErr) {
      logger.warn('[TEP] Generation failed — serving vault file without TEP', { error: (tepErr as Error).message });
    }

    res.send(fileBuffer);
  } catch (err) { next(err); }
}

// ── Get links for a vault ─────────────────────────────────────────────────────

export async function getVaultShareLinks(req: Request, res: Response, next: NextFunction): Promise<void> {
  try {
    const ownerUserId = getAuthUserId(req);
    const links = await shareLinkService.listByVault(req.params['vaultId']!, ownerUserId);
    res.json({ success: true, count: links.length, links });
  } catch (err) { next(err); }
}

// ── Get timeline events for a DNA record ──────────────────────────────────────

export async function getShareTimeline(req: Request, res: Response, next: NextFunction): Promise<void> {
  try {
    const ownerUserId = getAuthUserId(req);
    const events = await shareLinkService.getTimelineEvents(req.params['dnaId']!, ownerUserId);
    res.json({ success: true, events });
  } catch (err) { next(err); }
}

// ── Revoke ─────────────────────────────────────────────────────────────────────

export async function revokeShareLink(req: Request, res: Response, next: NextFunction): Promise<void> {
  try {
    const ownerUserId = getAuthUserId(req);
    const link = await shareLinkService.revoke(req.params['token']!, ownerUserId);
    res.json({ success: true, message: 'Share link revoked', token: link.token });
  } catch (err) { next(err); }
}

// ── Block a single viewer (device / session / IP) ───────────────────────────────

export async function blockShareViewer(req: Request, res: Response, next: NextFunction): Promise<void> {
  try {
    const ownerUserId = (req as { user?: { sub?: string } }).user?.sub;
    if (!ownerUserId) { res.status(401).json({ success: false, error: 'Unauthorized' }); return; }

    const { deviceFingerprint, sessionId, ipAddress, label, reason } = req.body as {
      deviceFingerprint?: string; sessionId?: string; ipAddress?: string; label?: string; reason?: string;
    };

    if (!deviceFingerprint && !sessionId && !ipAddress) {
      res.status(400).json({ success: false, error: 'Provide deviceFingerprint, sessionId, or ipAddress' });
      return;
    }

    const block = await shareLinkService.blockViewer(req.params['token']!, ownerUserId, {
      deviceFingerprint, sessionId, ipAddress, label, reason,
    });

    res.json({ success: true, message: 'Viewer access revoked', block });
  } catch (err) { next(err); }
}

export async function unblockShareViewer(req: Request, res: Response, next: NextFunction): Promise<void> {
  try {
    const ownerUserId = (req as { user?: { sub?: string } }).user?.sub;
    if (!ownerUserId) { res.status(401).json({ success: false, error: 'Unauthorized' }); return; }

    await shareLinkService.unblockViewer(
      req.params['token']!,
      ownerUserId,
      req.params['blockId']!,
    );

    res.json({ success: true, message: 'Viewer unblocked' });
  } catch (err) { next(err); }
}

// ── Debug / Test Report ───────────────────────────────────────────────────────
// GET /share/debug/report
// Returns a full diagnostic: public URL, IP headers, last DB value.

export async function debugReport(req: Request, res: Response, next: NextFunction): Promise<void> {
  try {
    const publicBase  = resolvePublicBaseUrl(req);
    const sampleToken = 'EXAMPLE_TOKEN';
    const sampleUrl   = `${publicBase}/s/${sampleToken}`;
    const ipHeaders   = dumpIpHeaders(req);

    // Fetch last 3 access log IPs from DB for comparison
    const lastLogs = await prisma.shareAccessLog.findMany({
      orderBy: { createdAt: 'desc' },
      take: 3,
      select: { ipAddress: true, action: true, createdAt: true, shareLink: { select: { token: true } } },
    });

    res.json({
      success: true,
      report: {
        publicDomain:  publicBase,
        sampleShareUrl: sampleUrl,
        envVars: {
          PUBLIC_APP_URL: process.env['PUBLIC_APP_URL'] ?? 'NOT SET',
          NGROK_URL:      process.env['NGROK_URL']      ?? 'NOT SET',
          FRONTEND_URL:   process.env['FRONTEND_URL']   ?? 'NOT SET (removed)',
        },
        ipHeaders,
        lastStoredIps: lastLogs.map(l => ({
          action:    l.action,
          ipAddress: l.ipAddress ?? 'NULL in DB',
          token:     l.shareLink.token,
          at:        l.createdAt,
        })),
      },
    });
  } catch (err) { next(err); }
}

// ── Privacy Masking — Serve masked file text ──────────────────────────────────
// GET /share/:token/masked-text
// Returns extracted + masked plain text (never the original file bytes).

export async function getMaskedText(req: Request, res: Response, next: NextFunction): Promise<void> {
  try {
    const { token } = req.params;
    const sessionId = req.query['sessionId'] as string | undefined;

    const fullLink = await prisma.shareLink.findUnique({ where: { token } });
    if (!fullLink || !fullLink.privacyMaskingEnabled) {
      res.status(404).json({ success: false, error: 'Masking not enabled for this link' });
      return;
    }

    // Check if this session has an approved unmask request
    let isUnmasked = false;
    if (sessionId) {
      const approved = await prisma.unmaskRequest.findFirst({
        where: { shareToken: token, sessionId, status: 'APPROVED' },
      });
      isUnmasked = !!approved;
    }

    // Decrypt the vault file (read-only — original never modified)
    const vaultResult = await vaultService.retrieve(fullLink.vaultId);
    const buffer = vaultResult.originalBuffer;
    const mime   = fullLink.mimeType;

    let rawText = '';
    if (mime === 'application/pdf') {
      rawText = await extractTextFromPdf(buffer);
    } else if (mime === 'application/vnd.openxmlformats-officedocument.wordprocessingml.document') {
      rawText = await extractTextFromDocx(buffer);
    } else if (mime.startsWith('text/') || mime === 'application/json') {
      rawText = extractTextFromPlain(buffer);
    } else {
      res.status(422).json({ success: false, error: 'File type does not support text masking' });
      return;
    }

    let displayText = rawText;
    if (!isUnmasked) {
      const maskConfig: MaskingConfig = {
        maskEmail:          fullLink.maskEmail,
        maskPhone:          fullLink.maskPhone,
        maskAadhaar:        fullLink.maskAadhaar,
        maskPan:            fullLink.maskPan,
        maskAddress:        fullLink.maskAddress,
        maskCustomPatterns: fullLink.maskCustomPatterns
          ? (JSON.parse(fullLink.maskCustomPatterns) as string[])
          : [],
      };
      displayText = applyMasks(rawText, maskConfig);
    }

    if (isUnmasked) {
      auditService.log({ eventType: 'UNMASK_VIEWED', filename: fullLink.filename, req });
    }

    res.json({ success: true, text: displayText, isUnmasked, filename: fullLink.filename, mimeType: mime });
  } catch (err) { next(err); }
}

// ── Privacy Masking — Request unmasked access ─────────────────────────────────
// POST /share/:token/unmask-request

export async function requestUnmask(req: Request, res: Response, next: NextFunction): Promise<void> {
  try {
    const { token } = req.params;
    const { recipientName, sessionId } = req.body as { recipientName?: string; sessionId?: string };

    const fullLink = await prisma.shareLink.findUnique({ where: { token } });
    if (!fullLink) { res.status(404).json({ success: false, error: 'Link not found' }); return; }

    const ua    = req.headers['user-agent'] ?? '';
    const device = /Mobi|Android/.test(ua) ? 'mobile' : /Tablet|iPad/.test(ua) ? 'tablet' : 'desktop';
    const ip    = resolveClientIp(req);

    // Check for existing pending request from this session
    const existing = await prisma.unmaskRequest.findFirst({
      where: { shareToken: token, sessionId: sessionId ?? '', status: 'PENDING' },
    });
    if (existing) {
      res.json({ success: true, requestId: existing.id, status: 'PENDING', message: 'Request already pending' });
      return;
    }

    const unmaskReq = await prisma.unmaskRequest.create({
      data: {
        shareToken:    token,
        recipientName: recipientName ?? null,
        sessionId:     sessionId ?? null,
        ipAddress:     ip,
        device,
        browser:       ua.match(/Chrome|Firefox|Safari|Edge|Opera/)?.[0] ?? null,
        os:            /Windows/.test(ua) ? 'Windows' : /Mac/.test(ua) ? 'macOS' : /Linux/.test(ua) ? 'Linux' : null,
        status:        'PENDING',
      },
    });

    auditService.log({ eventType: 'UNMASK_REQUESTED', filename: fullLink.filename, req,
      detail: { shareToken: token, sessionId, recipientName } });

    res.status(201).json({ success: true, requestId: unmaskReq.id, status: 'PENDING' });
  } catch (err) { next(err); }
}

// ── Privacy Masking — Check unmask status for a session ──────────────────────
// GET /share/:token/unmask-status?sessionId=xxx

export async function getUnmaskStatus(req: Request, res: Response, next: NextFunction): Promise<void> {
  try {
    const { token } = req.params;
    const sessionId = req.query['sessionId'] as string | undefined;

    const request = await prisma.unmaskRequest.findFirst({
      where: { shareToken: token, sessionId: sessionId ?? '' },
      orderBy: { createdAt: 'desc' },
    });

    res.json({ success: true, status: request?.status ?? 'NONE', requestId: request?.id ?? null });
  } catch (err) { next(err); }
}

// ── Privacy Masking — List all unmask requests (owner dashboard) ──────────────
// GET /share/unmask-requests

export async function listUnmaskRequests(req: Request, res: Response, next: NextFunction): Promise<void> {
  try {
    const ownerUserId = getAuthUserId(req);
    const requests = await prisma.unmaskRequest.findMany({
      where: { shareLink: { ownerUserId } },
      orderBy: { createdAt: 'desc' },
      take: 200,
      include: { shareLink: { select: { filename: true, token: true } } },
    });
    res.json({ success: true, requests });
  } catch (err) { next(err); }
}

// ── Privacy Masking — Approve / Reject unmask request ────────────────────────
// POST /share/unmask-requests/:id/approve
// POST /share/unmask-requests/:id/reject

export async function reviewUnmaskRequest(req: Request, res: Response, next: NextFunction): Promise<void> {
  try {
    const { id } = req.params;
    const action  = req.body['action'] as 'approve' | 'reject';
    const note    = req.body['note'] as string | undefined;

    if (!['approve', 'reject'].includes(action)) {
      res.status(400).json({ success: false, error: 'action must be approve or reject' });
      return;
    }

    const ownerUserId = getAuthUserId(req);

    const existing = await prisma.unmaskRequest.findUnique({
      where: { id },
      include: { shareLink: { select: { ownerUserId: true, filename: true } } },
    });
    if (!existing) {
      res.status(404).json({ success: false, error: 'Unmask request not found' });
      return;
    }
    if (existing.shareLink.ownerUserId !== ownerUserId) {
      res.status(403).json({ success: false, error: 'Access denied' });
      return;
    }

    const status = action === 'approve' ? 'APPROVED' : 'REJECTED';
    const updated = await prisma.unmaskRequest.update({
      where: { id },
      data: { status, reviewedAt: new Date(), reviewNote: note ?? null },
      include: { shareLink: { select: { filename: true } } },
    });

    auditService.log({
      eventType: action === 'approve' ? 'UNMASK_APPROVED' : 'UNMASK_REJECTED',
      filename: updated.shareLink.filename,
      req,
      detail: { requestId: id, recipientName: updated.recipientName, sessionId: updated.sessionId },
    });

    res.json({ success: true, status, requestId: id });
  } catch (err) { next(err); }
}

// ── Global Share Analytics — all metrics for dashboard ────────────────────────
// GET /share/analytics/global
export async function getGlobalShareStats(req: Request, res: Response, next: NextFunction): Promise<void> {
  try {
    const ownerUserId = getAuthUserId(req);
    const logs = await prisma.shareAccessLog.findMany({
      where: { shareLink: { ownerUserId } },
      select: {
        action: true, country: true, city: true,
        sessionDurationSec: true, sessionId: true,
        riskScore: true, riskLevel: true,
        ipAddress: true, createdAt: true,
        shareLink: { select: { dnaRecordId: true } },
      },
    });

    const byAction = (a: string) => logs.filter(l => l.action === a).length;
    const uniqueSet = (fn: (l: typeof logs[0]) => string | null | undefined) =>
      new Set(logs.map(fn).filter(Boolean)).size;

    const viewed   = logs.filter(l => l.action === 'VIEWED');
    const avgViewTime = viewed.length
      ? Math.round(viewed.reduce((s, l) => s + (l.sessionDurationSec ?? 0), 0) / viewed.length)
      : 0;

    // Risk score distribution
    const riskDist = { LOW: 0, MEDIUM: 0, HIGH: 0, CRITICAL: 0 };
    for (const l of logs) {
      const k = (l.riskLevel ?? 'LOW') as keyof typeof riskDist;
      if (k in riskDist) riskDist[k]++;
    }

    // Unique recipients = unique (ip + sessionId) combos
    const uniqueRecipients = new Set(logs.map(l => `${l.ipAddress}|${l.sessionId}`)).size;

    res.json({
      success: true,
      stats: {
        totalViews:           byAction('VIEWED'),
        uniqueRecipients,
        countriesReached:     uniqueSet(l => l.country),
        citiesReached:        uniqueSet(l => l.city),
        avgViewTimeSec:       avgViewTime,
        downloads:            byAction('DOWNLOADED'),
        blockedDownloads:     byAction('BLOCKED_DOWNLOAD'),
        printAttempts:        byAction('PRINT_ATTEMPT'),
        copyAttempts:         byAction('COPY_ATTEMPT'),
        screenshotAttempts:   byAction('SCREENSHOT_ATTEMPT'),
        riskDistribution:     riskDist,
        // Not yet tracked — future feature placeholders
        pageCompletion:       null,
        forwardChains:        null,
        leakIncidents:        null,
        leakSources:          null,
      },
    });
  } catch (err) { next(err); }
}

// ── Leak Attribution — upload a leaked file to identify watermark ─────────────

import multer from 'multer';
import {
  extractWatermarkFromFile,
  attributeLeak,
} from '../../services/watermark/watermark.service';

const leakUpload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 50 * 1024 * 1024 } });
export const leakUploadMiddleware = leakUpload.single('file');

export async function attributeLeakedFile(req: Request, res: Response, next: NextFunction): Promise<void> {
  try {
    const file = (req as any).file as Express.Multer.File | undefined;
    if (!file) {
      res.status(400).json({ success: false, error: 'No file uploaded' });
      return;
    }

    const mimeType = file.mimetype;
    const extraction = await extractWatermarkFromFile(file.buffer, mimeType);

    if (!extraction.watermarkCode) {
      res.json({
        success: true,
        found: false,
        message: 'No PINIT-DNA watermark detected in this file',
        method: extraction.method,
      });
      return;
    }

    const attribution = await attributeLeak(extraction.watermarkCode);

    res.json({
      success: true,
      found: attribution.found,
      watermarkCode: extraction.watermarkCode,
      extractionMethod: extraction.method,
      confidence: attribution.confidence,
      attribution: attribution.found ? {
        watermarkProfile: attribution.watermarkProfile,
        recipientProfile: attribution.recipientProfile,
        shareLink:        attribution.shareLink,
      } : null,
    });
  } catch (err) { next(err); }
}


// ── Get link tree (parent + children + grandchildren) ────────────────────────

export async function getLinkTree(req: Request, res: Response, next: NextFunction): Promise<void> {
  try {
    const { token } = req.params as { token: string };
    const ownerUserId = (req as any).user?.sub as string;
    const tree = await shareLinkService.getLinkTree(token, ownerUserId);
    res.json({ success: true, tree });
  } catch (err) { next(err); }
}


// ── Trackable preview image (used as og:image in share viewer) ───────────────
// Every request to this endpoint is logged — so when WhatsApp crawls the OG
// image, or when a user taps the preview thumbnail, we record it.
// Serves a branded 1200x630 PNG with the file name overlaid.

export async function previewImage(req: Request, res: Response, next: NextFunction): Promise<void> {
  try {
    const { token } = req.params as { token: string };

    // Look up the share link
    const link = await prisma.shareLink.findUnique({ where: { token } });
    if (!link || !link.isActive) {
      res.status(404).json({ success: false, error: 'Share link not found' });
      return;
    }

    // Log this preview-image fetch as a PREVIEW_FETCH action
    const ip = (req.headers['x-forwarded-for'] as string)?.split(',')[0]?.trim() || req.ip || '';
    const ua = req.headers['user-agent'] || '';
    try {
      await prisma.shareAccessLog.create({
        data: {
          shareLinkId: link.id,
          ipAddress:   ip,
          userAgent:   ua,
          action:      'PREVIEW_FETCH',
          browser:     ua.includes('WhatsApp') ? 'WhatsApp' : ua.includes('Telegram') ? 'Telegram' : 'Unknown',
          device:      'crawler',
        },
      });
      logger.info('[SmartLink] Preview image fetched (tracked)', { token, ip, ua: ua.slice(0, 60) });
    } catch {
      // Non-fatal — still serve the image
    }

    // Generate a simple branded SVG → convert to PNG-like response
    // (We use SVG served as image/svg+xml — universally supported by WhatsApp/Telegram/etc.)
    const filename = link.filename || 'Secure File';
    const truncName = filename.length > 40 ? filename.slice(0, 37) + '...' : filename;

    const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="1200" height="630" viewBox="0 0 1200 630">
  <defs>
    <linearGradient id="bg" x1="0" y1="0" x2="1" y2="1">
      <stop offset="0%" stop-color="#4f46e5"/>
      <stop offset="100%" stop-color="#7c3aed"/>
    </linearGradient>
  </defs>
  <rect width="1200" height="630" fill="url(#bg)"/>
  <text x="100" y="200" font-family="Arial,sans-serif" font-size="72" font-weight="bold" fill="#ffffff">PINIT DNA</text>
  <text x="100" y="270" font-family="Arial,sans-serif" font-size="32" fill="#c4b5fd">Secure File Sharing · Human Origin Identity</text>
  <rect x="80" y="320" width="1040" height="200" rx="20" fill="rgba(255,255,255,0.12)"/>
  <text x="130" y="390" font-family="Arial,sans-serif" font-size="28" fill="#e0e7ff">📄 File</text>
  <text x="130" y="440" font-family="Arial,sans-serif" font-size="36" font-weight="bold" fill="#ffffff">${truncName}</text>
  <text x="130" y="490" font-family="Arial,sans-serif" font-size="24" fill="#a5b4fc">🔒 AES-256-GCM Encrypted · Access Tracked</text>
  <text x="100" y="590" font-family="Arial,sans-serif" font-size="22" fill="#818cf8">pinit-dna.onrender.com</text>
</svg>`;

    res.setHeader('Content-Type', 'image/svg+xml');
    res.setHeader('Cache-Control', 'public, max-age=3600');
    res.send(svg);
  } catch (err) { next(err); }
}
