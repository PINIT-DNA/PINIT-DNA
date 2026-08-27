/**
 * Client reports — Investigation → Evidence → Client-facing report.
 *
 * ── Why this is not just `generateEvidenceReport()` pointed at a client ──────
 *
 * That generator exists and is reused: its drawing engine (cover, section
 * headers, tables, integrity seal) is imported below rather than rebuilt. What
 * is NOT reused is its content, because the document it produces is internal by
 * design. It prints share tokens, IP addresses, VPN/TOR flags, risk scores, the
 * invisible watermark registry with recipient codes, and the DNA fingerprint
 * hash of the source file. Handing that to a client would leak live credentials
 * and tell them exactly how the watermarking works.
 *
 * So: one engine, two documents. The internal forensic pack stays as it is; the
 * client's copy is a redacted projection composed from the same primitives.
 *
 * ── How the redaction is enforced ───────────────────────────────────────────
 *
 * By allowlist, and once. `buildSnapshot` names every field that may reach a
 * client and copies nothing else. That snapshot is frozen into the row at issue
 * time and the PDF is rendered from the snapshot, never from a live query — so
 * a column added to Asset or EvidenceRecord next month cannot widen an
 * already-issued report, and a client re-opening the link sees what was
 * approved rather than what the database says today.
 *
 * Never in a snapshot: any database id, the DNA fingerprint or its hash, share
 * tokens, watermark codes, IP addresses, internal case notes, the investigation
 * timeline, team member identities, or anything belonging to another campaign.
 */
import crypto from 'crypto';
import { PDFDocument, StandardFonts } from 'pdf-lib';
import { prisma } from '../../lib/prisma';
import { AppError } from '../../api/middleware/error.middleware';
import { requireOrgRole } from './org-access.service';
import { OrganizationMemberRole } from './constants/org-rbac';
import { logOrgAudit } from './audit-log.service';
import { emitBusinessEvent } from '../platform-events/notification-policy';
import { campaignEvidenceService, hashSnapshot } from './campaign-evidence.service';
import {
  C, PAGE_W, PAGE_H, MARGIN, CONTENT_W,
  newPage, needsPage, sectionHeader, kv, tableRow, tableHeader,
  drawCover, drawFooters, rect, winAnsi,
} from '../evidence/evidence-report.service';
import type { DrawCtx } from '../evidence/evidence-report.service';

export type ClientReportStatus = 'DRAFT' | 'ISSUED' | 'REVOKED';

/** The shape a client may see. Anything not on this type never reaches them. */
export interface ClientReportSnapshot {
  reportCode: string;
  title: string;
  preparedBy: string;
  preparedFor: string | null;
  generatedAt: string;
  /** Written for the client by the team. Internal notes are never used here. */
  summary: string | null;
  campaign: { name: string; startedOn: string | null; endedOn: string | null };
  asset: {
    filename: string;
    protectedOn: string | null;
    isFingerprinted: boolean;
    isVaulted: boolean;
    isCertified: boolean;
  } | null;
  finding: {
    foundAt: string | null;
    host: string | null;
    confidence: string;
    similarityPercent: number;
    firstSeen: string | null;
  } | null;
  caseStatus: string;
  outcome: string | null;
  evidence: {
    reference: string;
    type: string;
    meaning: string;
    description: string;
    sourceUrl: string | null;
    sourceHost: string | null;
    collectedAt: string;
    integrity: string | null;
  }[];
}

const STATUS_FOR_CLIENT: Record<string, string> = {
  OPEN: 'Open',
  INVESTIGATING: 'Under investigation',
  AWAITING_CLIENT: 'Awaiting your decision',
  RESOLVED: 'Closed',
  DISMISSED: 'Closed — no action taken',
};

function confidenceLabel(similarity: number): string {
  if (similarity >= 0.95) return 'Looks identical';
  if (similarity >= 0.85) return 'Very close';
  if (similarity >= 0.70) return 'Possibly related';
  return 'Weak signal';
}

function newReportCode(): string {
  const stamp = new Date().toISOString().slice(2, 10).replace(/-/g, '');
  return `RPT-${stamp}-${crypto.randomBytes(3).toString('hex').toUpperCase()}`;
}

/** Opaque, high-entropy, and never derived from any internal id. */
function newAccessToken(): string {
  return crypto.randomBytes(32).toString('base64url');
}

async function loadCaseScoped(organizationId: string, investigationId: string) {
  const incident = await prisma.incident.findUnique({ where: { id: investigationId } });
  if (!incident) throw new AppError(404, 'Investigation not found');
  if (incident.organizationId && incident.organizationId === organizationId) return incident;
  if (incident.campaignId) {
    const owned = await prisma.campaign.findFirst({
      where: { id: incident.campaignId, organizationId }, select: { id: true },
    });
    if (owned) return incident;
  }
  throw new AppError(404, 'Investigation not found');
}

/**
 * Build the redacted projection.
 *
 * Every field is named explicitly. Nothing is spread, and no row object is
 * copied wholesale, so widening this requires editing this function.
 */
async function buildSnapshot(
  organizationId: string,
  incident: { id: string; incidentCode: string; status: string; campaignId: string | null;
              assetId: string | null; findingId: string | null; resolvedNote: string | null },
  title: string,
  summary: string | null,
): Promise<ClientReportSnapshot> {
  const [org, campaign, asset, finding, evidence] = await Promise.all([
    prisma.organization.findUnique({
      where: { id: organizationId }, select: { name: true },
    }),
    incident.campaignId
      ? prisma.campaign.findUnique({
          where: { id: incident.campaignId },
          select: {
            name: true, startDate: true, endDate: true,
            client: { select: { name: true } },
          },
        })
      : Promise.resolve(null),
    incident.assetId
      ? prisma.asset.findUnique({
          where: { id: incident.assetId },
          select: {
            originalFilename: true, createdAt: true,
            dnaId: true, vaultId: true, certificateId: true,
          },
        })
      : Promise.resolve(null),
    incident.findingId
      ? prisma.assetDiscovery.findUnique({
          where: { id: incident.findingId },
          select: { url: true, similarity: true, firstSeen: true },
        })
      : Promise.resolve(null),
    campaignEvidenceService.projectForClient(incident.id),
  ]);

  let host: string | null = null;
  if (finding?.url) { try { host = new URL(finding.url).hostname; } catch { host = null; } }

  return {
    reportCode: '',                       // filled by the caller once allocated
    title,
    preparedBy: org?.name ?? 'Your agency',
    preparedFor: campaign?.client?.name ?? null,
    generatedAt: new Date().toISOString(),
    summary,
    campaign: {
      name: campaign?.name ?? 'Campaign',
      startedOn: campaign?.startDate?.toISOString() ?? null,
      endedOn: campaign?.endDate?.toISOString() ?? null,
    },
    // Facts about protection, never the fingerprint itself. A client should know
    // their work is fingerprinted; the fingerprint is what makes it provable and
    // is exactly what must not travel.
    asset: asset
      ? {
          filename: asset.originalFilename,
          protectedOn: asset.createdAt.toISOString(),
          isFingerprinted: Boolean(asset.dnaId),
          isVaulted: Boolean(asset.vaultId),
          isCertified: Boolean(asset.certificateId),
        }
      : null,
    finding: finding
      ? {
          foundAt: finding.url,
          host,
          confidence: confidenceLabel(finding.similarity),
          similarityPercent: Math.round(finding.similarity * 100),
          firstSeen: finding.firstSeen.toISOString(),
        }
      : null,
    caseStatus: STATUS_FOR_CLIENT[incident.status] ?? 'In progress',
    // The team's recorded outcome. Case notes are never used — those are the
    // working record and often contain half-formed judgements.
    outcome: incident.resolvedNote,
    evidence,
  };
}

// ── PDF composition, on the shared engine ───────────────────────────────────

/**
 * Make every string in a snapshot drawable.
 *
 * The standard PDF fonts throw on anything they cannot encode, and a snapshot
 * carries user input at almost every position — filenames, campaign names,
 * evidence descriptions, URLs. Sanitising once here, rather than at each of the
 * forty-odd draw calls below, means a new field cannot be added without
 * protection.
 *
 * The seal is computed from the ORIGINAL snapshot, not this one, so what is
 * hashed stays what was stored.
 */
function drawable(v: unknown): any {
  if (typeof v === 'string') return winAnsi(v);
  if (Array.isArray(v)) return v.map(drawable);
  if (v && typeof v === 'object') {
    return Object.fromEntries(Object.entries(v).map(([k, x]) => [k, drawable(x)]));
  }
  return v;
}

function renderPdf(original: ClientReportSnapshot): Promise<Buffer> {
  return (async () => {
    const snapshot = drawable(original) as ClientReportSnapshot;
    const doc = await PDFDocument.create();
    const regular = await doc.embedFont(StandardFonts.Helvetica);
    const bold = await doc.embedFont(StandardFonts.HelveticaBold);
    const italic = await doc.embedFont(StandardFonts.HelveticaOblique);
    const boldItalic = await doc.embedFont(StandardFonts.HelveticaBoldOblique);
    const mono = await doc.embedFont(StandardFonts.Courier);

    const coverPage = doc.addPage([PAGE_W, PAGE_H]);
    let ctx: DrawCtx = {
      doc, page: coverPage, regular, bold, italic, boldItalic, mono,
      pages: [coverPage], y: PAGE_H - MARGIN,
    };

    const generatedAt = snapshot.generatedAt.replace('T', ' ').slice(0, 19) + ' UTC';
    const contentHash = hashSnapshot(original);

    ctx = drawCover(ctx, {
      reportType: 'Campaign Protection Report',
      subject: snapshot.campaign.name,
      generatedAt,
      reportId: snapshot.reportCode,
      // Not CONFIDENTIAL — that banner is for the internal forensic pack. This
      // document is written to be shown to the client it is addressed to.
      classification: 'INTERNAL',
      hash: contentHash,
    });

    ctx = newPage(ctx);
    ctx.y -= 10;

    // Who it is for, in plain words before anything technical.
    ctx.page.drawText(snapshot.title, { x: MARGIN, y: ctx.y, size: 16, font: bold, color: C.navy });
    ctx.y -= 22;
    ctx.page.drawText(`Prepared by ${snapshot.preparedBy}`, {
      x: MARGIN, y: ctx.y, size: 10, font: regular, color: C.darkGray,
    });
    ctx.y -= 14;
    if (snapshot.preparedFor) {
      ctx.page.drawText(`Prepared for ${snapshot.preparedFor}`, {
        x: MARGIN, y: ctx.y, size: 10, font: regular, color: C.darkGray,
      });
      ctx.y -= 14;
    }
    ctx.y -= 10;

    if (snapshot.summary) {
      ctx = sectionHeader(ctx, 'Summary');
      ctx.y -= 4;
      for (const line of wrap(snapshot.summary, 92)) {
        ctx = needsPage(ctx, 14);
        ctx.page.drawText(line, { x: MARGIN, y: ctx.y, size: 10, font: regular, color: C.black });
        ctx.y -= 14;
      }
      ctx.y -= 10;
    }

    ctx = sectionHeader(ctx, 'Campaign');
    ctx.y -= 4;
    ctx = kv(ctx, 'Campaign:', snapshot.campaign.name);
    if (snapshot.campaign.startedOn) {
      ctx = kv(ctx, 'Started:', snapshot.campaign.startedOn.slice(0, 10));
    }
    ctx = kv(ctx, 'Status:', snapshot.caseStatus);
    ctx.y -= 10;

    if (snapshot.asset) {
      ctx = sectionHeader(ctx, 'The work');
      ctx.y -= 4;
      ctx = kv(ctx, 'File:', snapshot.asset.filename);
      if (snapshot.asset.protectedOn) {
        ctx = kv(ctx, 'Protected since:', snapshot.asset.protectedOn.slice(0, 10));
      }
      const protections = [
        snapshot.asset.isFingerprinted && 'fingerprinted',
        snapshot.asset.isVaulted && 'held in the vault',
        snapshot.asset.isCertified && 'certified',
      ].filter(Boolean).join(', ');
      ctx = kv(ctx, 'Protection:', protections || 'none recorded');
      ctx.y -= 10;
    }

    if (snapshot.finding) {
      ctx = sectionHeader(ctx, 'What was found');
      ctx.y -= 4;
      ctx = kv(ctx, 'Found at:', snapshot.finding.host ?? '—');
      ctx = kv(ctx, 'Match:',
        `${snapshot.finding.confidence} (${snapshot.finding.similarityPercent}% similar)`);
      if (snapshot.finding.firstSeen) {
        ctx = kv(ctx, 'First seen:', snapshot.finding.firstSeen.slice(0, 10));
      }
      ctx.y -= 6;
      for (const line of wrap(
        'A match describes how closely a copy resembles your work. It is an '
        + 'observation, not a legal conclusion.', 92)) {
        ctx = needsPage(ctx, 12);
        ctx.page.drawText(line, { x: MARGIN, y: ctx.y, size: 8.5, font: italic, color: C.midGray });
        ctx.y -= 12;
      }
      ctx.y -= 10;
    }

    ctx = sectionHeader(ctx, 'Evidence collected');
    ctx.y -= 4;
    if (snapshot.evidence.length === 0) {
      ctx = needsPage(ctx, 40);
      for (const line of wrap(
        'No evidence has been collected against this case yet. This report records '
        + 'the case as it stands; it does not assert that anything was found.', 92)) {
        ctx.page.drawText(line, { x: MARGIN, y: ctx.y, size: 10, font: italic, color: C.midGray });
        ctx.y -= 14;
      }
      ctx.y -= 10;
    } else {
      const cols = [
        { label: 'REFERENCE', width: 95 },
        { label: 'TYPE', width: 110 },
        { label: 'SOURCE', width: 150 },
        { label: 'COLLECTED', width: 90 },
      ];
      ctx = tableHeader(ctx, cols);
      snapshot.evidence.forEach((e, i) => {
        ctx = tableRow(ctx, [
          { text: e.reference, width: 95, mono: true },
          { text: e.type.replace(/_/g, ' ').toLowerCase(), width: 110 },
          { text: e.sourceHost ?? '—', width: 150 },
          { text: e.collectedAt.slice(0, 10), width: 90 },
        ], i % 2 === 0 ? undefined : C.bgGray);
      });
      ctx.y -= 12;

      for (const e of snapshot.evidence) {
        ctx = needsPage(ctx, 46);
        ctx.page.drawText(e.reference, { x: MARGIN, y: ctx.y, size: 9, font: bold, color: C.navy });
        ctx.y -= 13;
        for (const line of wrap(e.description, 96)) {
          ctx = needsPage(ctx, 12);
          ctx.page.drawText(line, { x: MARGIN, y: ctx.y, size: 8.5, font: regular, color: C.black });
          ctx.y -= 12;
        }
        if (e.integrity) {
          ctx = needsPage(ctx, 12);
          ctx.page.drawText(`Integrity: ${e.integrity}`, {
            x: MARGIN, y: ctx.y, size: 8, font: mono, color: C.midGray,
          });
          ctx.y -= 12;
        }
        ctx.y -= 6;
      }
    }

    if (snapshot.outcome) {
      ctx = sectionHeader(ctx, 'Outcome');
      ctx.y -= 4;
      for (const line of wrap(snapshot.outcome, 92)) {
        ctx = needsPage(ctx, 14);
        ctx.page.drawText(line, { x: MARGIN, y: ctx.y, size: 10, font: regular, color: C.black });
        ctx.y -= 14;
      }
      ctx.y -= 10;
    }

    // A plain seal. No verification URL that implies a public lookup we do not
    // actually offer to clients.
    ctx = needsPage(ctx, 80);
    ctx.y -= 8;
    rect(ctx, MARGIN, ctx.y - 52, CONTENT_W, 58, C.navy);
    ctx.page.drawText('REPORT INTEGRITY', {
      x: MARGIN + 12, y: ctx.y - 12, size: 9, font: bold, color: C.purpleLight,
    });
    ctx.page.drawText('This report was sealed when it was issued and has not changed since.', {
      x: MARGIN + 12, y: ctx.y - 27, size: 8, font: regular, color: C.white,
    });
    ctx.page.drawText(`Reference : ${snapshot.reportCode}`, {
      x: MARGIN + 12, y: ctx.y - 40, size: 8, font: mono, color: C.lightGray,
    });
    ctx.page.drawText(`Seal      : ${contentHash.slice(0, 48)}`, {
      x: MARGIN + 12, y: ctx.y - 52, size: 7.5, font: mono, color: C.lightGray,
    });

    drawFooters(ctx, snapshot.reportCode);
    return Buffer.from(await doc.save());
  })();
}

/** Naive width-based wrap. Helvetica at these sizes is close enough to even. */
function wrap(str: string, perLine: number): string[] {
  const words = String(str).split(/\s+/);
  const lines: string[] = [];
  let line = '';
  for (const w of words) {
    if ((line + ' ' + w).trim().length > perLine) { if (line) lines.push(line); line = w; }
    else line = (line + ' ' + w).trim();
  }
  if (line) lines.push(line);
  return lines.length ? lines : [''];
}

export const campaignClientReportService = {
  /** Draft a report from a case. Nothing is visible to a client until issued. */
  async create(
    organizationId: string,
    actorUserId: string,
    investigationId: string,
    input: { title?: string; summary?: string; expiresInDays?: number },
  ) {
    await requireOrgRole(actorUserId, organizationId, OrganizationMemberRole.MEMBER);
    const incident = await loadCaseScoped(organizationId, investigationId);
    if (!incident.campaignId) {
      throw new AppError(400, 'This case is not attached to a campaign, so it has no client.');
    }

    const title = (input.title ?? '').trim() || `Protection report — ${incident.title ?? incident.incidentCode}`;
    if (title.length > 200) throw new AppError(400, 'Title is too long (200 characters max)');
    const summary = (input.summary ?? '').trim() || null;
    if (summary && summary.length > 4000) throw new AppError(400, 'Summary is too long (4000 max)');

    const reportCode = newReportCode();
    const snapshot = await buildSnapshot(organizationId, incident, title, summary);
    snapshot.reportCode = reportCode;

    const campaign = await prisma.campaign.findUnique({
      where: { id: incident.campaignId }, select: { clientId: true },
    });

    const days = input.expiresInDays;
    if (days !== undefined && (!Number.isInteger(days) || days < 1 || days > 365)) {
      throw new AppError(400, 'Expiry must be between 1 and 365 days');
    }

    const report = await prisma.clientReport.create({
      data: {
        reportCode,
        organizationId,
        campaignId: incident.campaignId,
        investigationId: incident.id,
        clientId: campaign?.clientId ?? null,
        title,
        status: 'DRAFT',
        accessToken: newAccessToken(),
        ...(days ? { expiresAt: new Date(Date.now() + days * 86400_000) } : {}),
        generatedByUserId: actorUserId,
        evidenceCount: snapshot.evidence.length,
        contentHash: hashSnapshot(snapshot),
        snapshot: JSON.stringify(snapshot),
      },
    });

    await logOrgAudit({
      organizationId, actorUserId,
      action: 'CLIENT_REPORT_DRAFTED',
      entityType: 'campaign', entityId: incident.campaignId,
      title: `Client report drafted: ${title}`,
      detail: { reportCode, evidenceCount: snapshot.evidence.length },
    });

    await emitBusinessEvent('report.generated', {
      organizationId,
      campaignId: incident.campaignId,
      reportId: report.id,
      reportCode,
      detail: title,
      actorUserId,
    });

    return shapeForBusiness(report, snapshot);
  },

  /** Issue it. Only from here does the access token open anything. */
  async issue(organizationId: string, actorUserId: string, reportId: string) {
    await requireOrgRole(actorUserId, organizationId, OrganizationMemberRole.MANAGER);
    const report = await prisma.clientReport.findFirst({
      where: { id: reportId, organizationId },
    });
    if (!report) throw new AppError(404, 'Report not found');
    if (report.status === 'REVOKED') throw new AppError(409, 'This report was revoked.');
    if (report.status === 'ISSUED') throw new AppError(409, 'This report is already issued.');

    const updated = await prisma.clientReport.update({
      where: { id: report.id },
      data: { status: 'ISSUED', issuedAt: new Date() },
    });

    await logOrgAudit({
      organizationId, actorUserId,
      action: 'CLIENT_REPORT_ISSUED',
      entityType: 'campaign', entityId: report.campaignId,
      title: `Client report issued: ${report.title}`,
      detail: { reportCode: report.reportCode },
    });

    await emitBusinessEvent('report.issued', {
      organizationId,
      campaignId: report.campaignId,
      reportId: report.id,
      reportCode: report.reportCode,
      detail: report.title,
      actorUserId,
    });

    return shapeForBusiness(updated, parseSnapshot(updated.snapshot));
  },

  /** Revoke access. The row and its snapshot are kept — the record stands. */
  async revoke(organizationId: string, actorUserId: string, reportId: string) {
    await requireOrgRole(actorUserId, organizationId, OrganizationMemberRole.MANAGER);
    const report = await prisma.clientReport.findFirst({
      where: { id: reportId, organizationId },
    });
    if (!report) throw new AppError(404, 'Report not found');
    if (report.status === 'REVOKED') throw new AppError(409, 'Already revoked.');

    const updated = await prisma.clientReport.update({
      where: { id: report.id },
      data: { status: 'REVOKED', revokedAt: new Date() },
    });

    await logOrgAudit({
      organizationId, actorUserId,
      action: 'CLIENT_REPORT_REVOKED',
      entityType: 'campaign', entityId: report.campaignId,
      title: `Client report revoked: ${report.title}`,
      detail: { reportCode: report.reportCode },
    });

    return shapeForBusiness(updated, parseSnapshot(updated.snapshot));
  },

  /** Reports for a campaign, for the business side. */
  async listForCampaign(organizationId: string, actorUserId: string, campaignId: string) {
    await requireOrgRole(actorUserId, organizationId, OrganizationMemberRole.VIEWER);
    const campaign = await prisma.campaign.findFirst({
      where: { id: campaignId, organizationId }, select: { id: true },
    });
    if (!campaign) throw new AppError(404, 'Campaign not found');

    const rows = await prisma.clientReport.findMany({
      where: { campaignId, organizationId },
      orderBy: { createdAt: 'desc' },
      take: 100,
    });
    return { reports: rows.map((r) => shapeForBusiness(r, parseSnapshot(r.snapshot))) };
  },

  /** One report, with the exact snapshot the client would see. */
  async getForBusiness(organizationId: string, actorUserId: string, reportId: string) {
    await requireOrgRole(actorUserId, organizationId, OrganizationMemberRole.VIEWER);
    const report = await prisma.clientReport.findFirst({
      where: { id: reportId, organizationId },
    });
    if (!report) throw new AppError(404, 'Report not found');
    return shapeForBusiness(report, parseSnapshot(report.snapshot));
  },

  /** The business-side PDF preview — identical bytes to the client's copy. */
  async renderForBusiness(organizationId: string, actorUserId: string, reportId: string) {
    await requireOrgRole(actorUserId, organizationId, OrganizationMemberRole.VIEWER);
    const report = await prisma.clientReport.findFirst({
      where: { id: reportId, organizationId },
    });
    if (!report) throw new AppError(404, 'Report not found');
    const snapshot = parseSnapshot(report.snapshot);
    if (!snapshot) throw new AppError(409, 'This report has no content.');
    return { pdf: await renderPdf(snapshot), filename: `${report.reportCode}.pdf` };
  },

  /**
   * Client access by token.
   *
   * No authentication and no organization context — the token is the whole
   * credential, so everything that decides access is checked here: issued, not
   * revoked, not expired. Returns the frozen snapshot and nothing else; the
   * database row's ids never leave this function.
   */
  async getForClient(token: string) {
    if (!token || token.length < 20) throw new AppError(404, 'Report not found');

    const report = await prisma.clientReport.findUnique({
      where: { accessToken: token },
      select: {
        id: true, status: true, expiresAt: true, snapshot: true,
        firstOpenedAt: true, openCount: true,
        campaignId: true, reportCode: true, title: true, generatedByUserId: true,
      },
    });
    // One message for every failure. A client with a bad link learns that it
    // does not work, not whether it ever existed.
    if (!report || report.status !== 'ISSUED') throw new AppError(404, 'Report not found');
    if (report.expiresAt && report.expiresAt.getTime() < Date.now()) {
      throw new AppError(410, 'This report has expired. Ask for a new link.');
    }
    const snapshot = parseSnapshot(report.snapshot);
    if (!snapshot) throw new AppError(404, 'Report not found');

    const isFirstOpen = !report.firstOpenedAt;

    await prisma.clientReport.update({
      where: { id: report.id },
      data: {
        openCount: { increment: 1 },
        lastOpenedAt: new Date(),
        ...(isFirstOpen ? { firstOpenedAt: new Date() } : {}),
      },
    });

    // Only the first open, and only to whoever issued it — that is the person
    // waiting to know it landed. A client rereading the report is not news, and
    // the client is not a user of this system, so there is no actor to exclude.
    if (isFirstOpen) {
      await emitBusinessEvent('report.opened_by_client', {
        campaignId: report.campaignId,
        reportId: report.id,
        reportCode: report.reportCode,
        detail: report.title,
      });
    }

    return snapshot;
  },

  /** The client's PDF, rendered from the same frozen snapshot. */
  async renderForClient(token: string) {
    const snapshot = await campaignClientReportService.getForClient(token);
    return { pdf: await renderPdf(snapshot), filename: `${snapshot.reportCode}.pdf` };
  },
};

function parseSnapshot(raw: string | null): ClientReportSnapshot | null {
  if (!raw) return null;
  try { return JSON.parse(raw) as ClientReportSnapshot; } catch { return null; }
}

/**
 * The business-side view.
 *
 * Carries the report id (the team needs it to act) and the access token, which
 * the team must be able to copy in order to send the link. Neither ever appears
 * in a snapshot.
 */
function shapeForBusiness(
  r: {
    id: string; reportCode: string; title: string; status: string;
    accessToken: string; createdAt: Date; issuedAt: Date | null;
    expiresAt: Date | null; revokedAt: Date | null; firstOpenedAt: Date | null;
    lastOpenedAt: Date | null; openCount: number; evidenceCount: number;
    contentHash: string | null; investigationId: string; campaignId: string;
  },
  snapshot: ClientReportSnapshot | null,
) {
  const expired = Boolean(r.expiresAt && r.expiresAt.getTime() < Date.now());
  return {
    id: r.id,
    reportCode: r.reportCode,
    title: r.title,
    status: r.status as ClientReportStatus,
    investigationId: r.investigationId,
    campaignId: r.campaignId,
    accessToken: r.accessToken,
    createdAt: r.createdAt.toISOString(),
    issuedAt: r.issuedAt?.toISOString() ?? null,
    expiresAt: r.expiresAt?.toISOString() ?? null,
    revokedAt: r.revokedAt?.toISOString() ?? null,
    firstOpenedAt: r.firstOpenedAt?.toISOString() ?? null,
    lastOpenedAt: r.lastOpenedAt?.toISOString() ?? null,
    openCount: r.openCount,
    evidenceCount: r.evidenceCount,
    isExpired: expired,
    isLive: r.status === 'ISSUED' && !expired,
    seal: r.contentHash ? `${r.contentHash.slice(0, 16)}…` : null,
    /** Exactly what the client sees — so the team can check before issuing. */
    preview: snapshot,
  };
}
