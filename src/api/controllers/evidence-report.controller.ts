/**
 * PINIT-DNA — Evidence Report Controller (Phase 3)
 *
 * POST /api/v1/evidence/report        — Generate + stream PDF evidence report
 * GET  /api/v1/evidence/records       — List all evidence records
 * GET  /api/v1/evidence/records/:id   — Get single evidence record
 */

import { Request, Response, NextFunction } from 'express';
import { generateEvidenceReport, ReportOptions } from '../../services/evidence/evidence-report.service';
import { prisma } from '../../lib/prisma';
import { logger } from '../../lib/logger';
import { getAuthUserId, assertEvidenceOwner } from '../../lib/tenant-scope';

export async function generateReport(req: Request, res: Response, next: NextFunction): Promise<void> {
  try {
    const {
      type,
      shareLinkId,
      dnaRecordId,
      incidentId,
      watermarkCode,
      classification,
    } = req.body as ReportOptions & { classification?: 'CONFIDENTIAL' | 'RESTRICTED' | 'INTERNAL' };

    if (!type) {
      res.status(400).json({ success: false, error: 'Report type is required: SHARE_LINK | DNA_RECORD | INCIDENT | LEAK_ATTRIBUTION' });
      return;
    }

    const requestedBy = getAuthUserId(req);

    logger.info('[EvidenceReport] Generating report', { type, shareLinkId, dnaRecordId, incidentId, watermarkCode });

    const pdfBuffer = await generateEvidenceReport({
      type,
      shareLinkId,
      dnaRecordId,
      incidentId,
      watermarkCode,
      classification: classification ?? 'CONFIDENTIAL',
      requestedBy,
    });

    const filename = `PINIT-DNA-Evidence-${type}-${Date.now()}.pdf`;

    res.set({
      'Content-Type':        'application/pdf',
      'Content-Disposition': `attachment; filename="${filename}"`,
      'Content-Length':      String(pdfBuffer.length),
      'Cache-Control':       'no-store',
      'X-Report-Type':       type,
    });

    res.send(pdfBuffer);
  } catch (err) {
    next(err);
  }
}

export async function listEvidenceRecords(req: Request, res: Response, next: NextFunction): Promise<void> {
  try {
    const userId = getAuthUserId(req);
    const { incidentId, dnaRecordId, shareLinkId, limit = '50', offset = '0' } = req.query as Record<string, string>;

    const ownedDnaIds = (await prisma.dnaRecord.findMany({
      where: { ownerUserId: userId },
      select: { id: true },
    })).map((d) => d.id);

    const where: Record<string, unknown> = {
      OR: [
        { ownerUserId: userId },
        ...(ownedDnaIds.length ? [{ dnaRecordId: { in: ownedDnaIds } }] : []),
        { shareLink: { ownerUserId: userId } },
      ],
    };
    if (incidentId)  where['incidentId']  = incidentId;
    if (dnaRecordId) where['dnaRecordId'] = dnaRecordId;
    if (shareLinkId) where['shareLinkId'] = shareLinkId;

    const [records, total] = await Promise.all([
      prisma.evidenceRecord.findMany({
        where,
        orderBy: { createdAt: 'desc' },
        take:   parseInt(limit,  10),
        skip:   parseInt(offset, 10),
        include: { incident: { select: { incidentCode: true, severity: true, status: true } } },
      }),
      prisma.evidenceRecord.count({ where }),
    ]);

    res.json({ success: true, total, records });
  } catch (err) { next(err); }
}

export async function getEvidenceRecord(req: Request, res: Response, next: NextFunction): Promise<void> {
  try {
    const userId = getAuthUserId(req);
    await assertEvidenceOwner(req.params['id']!, userId);

    const record = await prisma.evidenceRecord.findUnique({
      where: { id: req.params['id']! },
      include: { incident: true },
    });
    if (!record) {
      res.status(404).json({ success: false, error: 'Evidence record not found' });
      return;
    }
    res.json({ success: true, record });
  } catch (err) { next(err); }
}

export async function listIncidents(req: Request, res: Response, next: NextFunction): Promise<void> {
  try {
    const userId = getAuthUserId(req);
    const { dnaRecordId, shareLinkId, severity, status, limit = '50', offset = '0' } = req.query as Record<string, string>;

    const [ownedDnaIds, ownedShareIds] = await Promise.all([
      prisma.dnaRecord.findMany({ where: { ownerUserId: userId }, select: { id: true } }).then((r) => r.map((d) => d.id)),
      prisma.shareLink.findMany({ where: { ownerUserId: userId }, select: { id: true } }).then((r) => r.map((s) => s.id)),
    ]);

    const where: Record<string, unknown> = {
      OR: [
        ...(ownedDnaIds.length ? [{ dnaRecordId: { in: ownedDnaIds } }] : []),
        ...(ownedShareIds.length ? [{ shareLinkId: { in: ownedShareIds } }] : []),
      ],
    };
    if (!ownedDnaIds.length && !ownedShareIds.length) {
      res.json({ success: true, total: 0, incidents: [] });
      return;
    }
    if (dnaRecordId) where['dnaRecordId'] = dnaRecordId;
    if (shareLinkId) where['shareLinkId'] = shareLinkId;
    if (severity)    where['severity']    = severity;
    if (status)      where['status']      = status;

    const [incidents, total] = await Promise.all([
      prisma.incident.findMany({
        where,
        orderBy: { createdAt: 'desc' },
        take:   parseInt(limit,  10),
        skip:   parseInt(offset, 10),
        include: { evidenceRecords: { select: { id: true, evidenceCode: true, evidenceType: true } } },
      }),
      prisma.incident.count({ where }),
    ]);

    res.json({ success: true, total, incidents });
  } catch (err) { next(err); }
}

export async function getIncident(req: Request, res: Response, next: NextFunction): Promise<void> {
  try {
    const incident = await prisma.incident.findUnique({
      where: { id: req.params['id']! },
      include: { evidenceRecords: true },
    });
    if (!incident) {
      res.status(404).json({ success: false, error: 'Incident not found' });
      return;
    }
    res.json({ success: true, incident });
  } catch (err) { next(err); }
}

export async function updateIncidentStatus(req: Request, res: Response, next: NextFunction): Promise<void> {
  try {
    const { status, resolvedNote } = req.body as { status: string; resolvedNote?: string };
    const validStatuses = ['OPEN', 'INVESTIGATING', 'RESOLVED', 'DISMISSED'];
    if (!validStatuses.includes(status)) {
      res.status(400).json({ success: false, error: `Invalid status. Must be one of: ${validStatuses.join(', ')}` });
      return;
    }

    const incident = await prisma.incident.update({
      where: { id: req.params['id']! },
      data: {
        status,
        resolvedAt:   status === 'RESOLVED' || status === 'DISMISSED' ? new Date() : null,
        resolvedNote: resolvedNote ?? null,
      },
    });
    res.json({ success: true, incident });
  } catch (err) { next(err); }
}

export async function listRecipients(req: Request, res: Response, next: NextFunction): Promise<void> {
  try {
    const { limit = '50', offset = '0' } = req.query as Record<string, string>;

    const [recipients, total] = await Promise.all([
      prisma.recipientProfile.findMany({
        orderBy: { lastSeen: 'desc' },
        take:   parseInt(limit,  10),
        skip:   parseInt(offset, 10),
        include: {
          watermarkProfiles: {
            select: { watermarkCode: true, extractedAt: true, createdAt: true },
            orderBy: { createdAt: 'desc' },
            take: 5,
          },
        },
      }),
      prisma.recipientProfile.count(),
    ]);

    res.json({ success: true, total, recipients });
  } catch (err) { next(err); }
}
