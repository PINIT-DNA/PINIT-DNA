import { prisma } from '../../lib/prisma';
import { logger } from '../../lib/logger';
import { PerceptualLayer } from '../layers/layer3.perceptual';
import {
  POSSIBLE_VISUAL,
  decidePublicScan,
  type PublicScanDraft,
} from './public-scan-decision';

const SCAN_POOL = 400;
const perceptual = new PerceptualLayer();

interface Candidate {
  dnaRecordId: string;
  createdAt: Date;
  filename: string;
  ownerName: string;
  pHash64: string;
  aHash64: string;
  dHash64: string;
  visual: number;
}

interface ScanPrefs {
  optOut: boolean;
  showTitle: boolean;
  showRecipient: boolean;
}

const SAFE_PREFS: ScanPrefs = { optOut: false, showTitle: false, showRecipient: false };

function notFound(): PublicScanDraft {
  return { verdict: 'not_found' };
}

async function prefsFor(dnaRecordId: string): Promise<ScanPrefs> {
  try {
    const rows = await prisma.$queryRaw<Array<ScanPrefs & { optOut: boolean }>>`
      SELECT
        "publicScanOptOut" AS "optOut",
        "publicScanShowTitle" AS "showTitle",
        "publicScanShowRecipient" AS "showRecipient"
      FROM dna_records
      WHERE id = ${dnaRecordId}
      LIMIT 1
    `;
    const row = rows[0];
    if (!row) return SAFE_PREFS;
    return {
      optOut: Boolean(row.optOut),
      showTitle: Boolean(row.showTitle),
      showRecipient: Boolean(row.showRecipient),
    };
  } catch {
    return SAFE_PREFS;
  }
}

async function recipientLabel(dnaRecordId: string): Promise<string | null> {
  try {
    const rows = await prisma.$queryRaw<Array<{ recipientLabel: string | null }>>`
      SELECT "recipientLabel"
      FROM watermark_lookups
      WHERE "dnaRecordId" = ${dnaRecordId} AND "recipientLabel" IS NOT NULL
      ORDER BY "createdAt" DESC
      LIMIT 1
    `;
    return rows[0]?.recipientLabel ?? null;
  } catch {
    return null;
  }
}

function draftFrom(candidate: Candidate, prefs: ScanPrefs, verdict: PublicScanDraft['verdict'], strength: number, another: boolean): PublicScanDraft {
  return {
    verdict,
    ownerName: candidate.ownerName || 'PINIT member',
    protectedAt: candidate.createdAt.toISOString(),
    matchStrength: strength,
    title: prefs.showTitle ? candidate.filename : null,
    recipientLabel: null,
    anotherRegistration: another,
    dnaRecordId: candidate.dnaRecordId,
  };
}

export interface PublicScanDetail {
  optOut: boolean;
  ownerName?: string;
  protectedAt?: string;
  title?: string | null;
  recipientLabel?: string | null;
}

/** Re-reads owner-approved fields. Returns null when the record is gone or hidden. */
export async function loadPublicScanDetails(dnaRecordId: string): Promise<PublicScanDetail | null> {
  const record = await prisma.dnaRecord.findUnique({
    where: { id: dnaRecordId },
    select: { createdAt: true, imageFilename: true, ownerUser: { select: { fullName: true } } },
  });
  if (!record) return null;
  const prefs = await prefsFor(dnaRecordId);
  if (prefs.optOut) return { optOut: true };
  return {
    optOut: false,
    ownerName: record.ownerUser?.fullName || 'PINIT member',
    protectedAt: record.createdAt.toISOString(),
    title: prefs.showTitle ? record.imageFilename : null,
    recipientLabel: prefs.showRecipient ? await recipientLabel(dnaRecordId) : null,
  };
}

async function confirmFeatures(buffer: Buffer, mimeType: string, dnaRecordId: string): Promise<boolean> {
  try {
    const row = await prisma.localFeatureIndex.findUnique({
      where: { dnaRecordId },
      select: { orbDescriptors: true, status: true },
    });
    if (!row || row.status !== 'COMPLETE' || row.orbDescriptors == null) return false;
    const { aiService } = await import('../ai/ai-embeddings.service');
    const probe = await aiService.extractLocalDnaIndex(buffer, mimeType);
    if (!probe?.orbDescriptors) return false;
    const matched = await Promise.race([
      aiService.matchDescriptorSets(probe.orbDescriptors, row.orbDescriptors),
      new Promise<null>((resolve) => setTimeout(() => resolve(null), 8000)),
    ]);
    return (matched?.similarity ?? 0) >= 0.5;
  } catch {
    return false;
  }
}

async function visualCandidates(buffer: Buffer): Promise<Candidate[]> {
  const probe = await perceptual.computeFingerprints(buffer);
  const stored = await prisma.perceptualLayer.findMany({
    where: { dnaRecord: { is: { ownerUserId: { not: null } } } },
    select: {
      dnaRecordId: true,
      pHash64: true,
      aHash64: true,
      dHash64: true,
      dnaRecord: {
        select: {
          createdAt: true,
          imageFilename: true,
          ownerUser: { select: { fullName: true } },
        },
      },
    },
    orderBy: { dnaRecord: { createdAt: 'desc' } },
    take: SCAN_POOL,
  });
  const ranked: Candidate[] = [];
  for (const row of stored) {
    if (!row.pHash64 || !row.dnaRecord) continue;
    const visual = perceptual.verify(probe, {
      pHash64: row.pHash64,
      aHash64: row.aHash64 ?? '',
      dHash64: row.dHash64 ?? '',
    });
    if (visual < POSSIBLE_VISUAL) continue;
    ranked.push({
      dnaRecordId: row.dnaRecordId,
      createdAt: row.dnaRecord.createdAt,
      filename: row.dnaRecord.imageFilename,
      ownerName: row.dnaRecord.ownerUser?.fullName ?? 'PINIT member',
      pHash64: row.pHash64,
      aHash64: row.aHash64 ?? '',
      dHash64: row.dHash64 ?? '',
      visual,
    });
  }
  ranked.sort((a, b) => b.visual - a.visual);
  return ranked;
}

export async function scanPublicImage(buffer: Buffer, mimeType: string): Promise<PublicScanDraft> {
  if (!mimeType.startsWith('image/')) return notFound();
  try {
    const { extractWatermarkMatch } = await import('../dna-vnext/robust-watermark');
    const { findWatermarkCopy } = await import('../dna-vnext/watermark-index');
    const mark = await extractWatermarkMatch(buffer);
    if (mark) {
      const copy = await findWatermarkCopy(mark.lookupId);
      if (copy) {
        const prefs = await prefsFor(copy.dnaRecordId);
        if (!prefs.optOut) {
          const created = await prisma.dnaRecord.findUnique({
            where: { id: copy.dnaRecordId },
            select: { createdAt: true, imageFilename: true },
          });
          const label = prefs.showRecipient ? await recipientLabel(copy.dnaRecordId) : null;
          return {
            verdict: 'protected',
            ownerName: copy.ownerName || 'PINIT member',
            protectedAt: created?.createdAt.toISOString(),
            matchStrength: mark.strengthPercent,
            title: prefs.showTitle ? (created?.imageFilename ?? copy.filename) : null,
            recipientLabel: label,
            dnaRecordId: copy.dnaRecordId,
          };
        }
      }
    }
  } catch (err) {
    logger.warn('Public scan mark read skipped', { error: String(err) });
  }

  let ranked: Candidate[] = [];
  try {
    ranked = await visualCandidates(buffer);
  } catch (err) {
    logger.warn('Public scan visual search skipped', { error: String(err) });
    return notFound();
  }

  const visible: Candidate[] = [];
  for (const candidate of ranked) {
    const prefs = await prefsFor(candidate.dnaRecordId);
    if (!prefs.optOut) visible.push(candidate);
  }
  if (!visible.length) return notFound();

  const earliest = [...visible].sort((a, b) => a.createdAt.getTime() - b.createdAt.getTime())[0]!;
  const shown = earliest;
  const another = visible.length > 1 && visible.some((c) => c.dnaRecordId !== shown.dnaRecordId);
  const featureConfirmed = await confirmFeatures(buffer, mimeType, shown.dnaRecordId);
  const verdict = decidePublicScan({
    markFound: false,
    visual: shown.visual,
    featureConfirmed,
  });
  if (verdict === 'not_found') return notFound();
  const prefs = await prefsFor(shown.dnaRecordId);
  const draft = draftFrom(shown, prefs, verdict, Math.round(shown.visual * 100), another);
  if (prefs.showRecipient) draft.recipientLabel = await recipientLabel(shown.dnaRecordId);
  return draft;
}
