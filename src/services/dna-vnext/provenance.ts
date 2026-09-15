import crypto from 'crypto';
import { prisma } from '../../lib/prisma';
import { logger } from '../../lib/logger';
import {
  DNA_VNEXT_AUTH_VERSION,
  DNA_VNEXT_FILE_ANALYSIS_KEY,
  DNA_VNEXT_VERSION,
  DNA_VNEXT_WATERMARK_VERSION,
  isDnaVnextEnabled,
} from '../../config/dna-vnext';
import type { StoredBlockDnaManifest } from '../../types/block-dna.types';
import type { DnaVnextProvenanceRecord } from '../../types/dna-vnext.types';
import { watermarkLookupId } from './crypto';
import { buildHierarchyFromBlockDna } from './hierarchy';

function asRecord(value: unknown): Record<string, unknown> {
  if (value && typeof value === 'object' && !Array.isArray(value)) {
    return value as Record<string, unknown>;
  }
  return {};
}

export function buildProvenanceRecord(params: {
  vaultId: string;
  dnaRecordId: string;
  certificateId: string | null;
  imageHash: string;
  format: string;
  stored: StoredBlockDnaManifest;
}): DnaVnextProvenanceRecord {
  const hier = buildHierarchyFromBlockDna(params.stored);
  return {
    version: DNA_VNEXT_VERSION,
    vaultId: params.vaultId,
    dnaRecordId: params.dnaRecordId,
    certificateId: params.certificateId,
    imageHash: params.imageHash,
    width: params.stored.width,
    height: params.stored.height,
    format: params.format,
    dnaVersion: DNA_VNEXT_VERSION,
    watermarkVersion: DNA_VNEXT_WATERMARK_VERSION,
    authenticationVersion: DNA_VNEXT_AUTH_VERSION,
    blockSize: params.stored.blockSize,
    watermarkLookupId: watermarkLookupId(params.vaultId, params.dnaRecordId),
    rootAuthenticationHex16: hier.rootAuthenticationHex16,
    regionManifest: hier.regions,
    createdAt: new Date().toISOString(),
  };
}

export async function persistProvenanceRecord(
  dnaRecordId: string,
  record: DnaVnextProvenanceRecord,
): Promise<void> {
  if (!isDnaVnextEnabled()) return;
  try {
    const row = await prisma.dnaRecord.findUnique({
      where: { id: dnaRecordId },
      select: { fileAnalysis: true },
    });
    if (!row) return;
    const next = asRecord(row.fileAnalysis);
    next[DNA_VNEXT_FILE_ANALYSIS_KEY] = record;
    await prisma.dnaRecord.update({
      where: { id: dnaRecordId },
      data: { fileAnalysis: next as object },
    });
  } catch (err) {
    logger.warn('DNA vNext provenance persist skipped', { dnaRecordId, error: String(err) });
  }
}

export function provenanceFromFileAnalysis(fileAnalysis: unknown): DnaVnextProvenanceRecord | null {
  const stored = asRecord(fileAnalysis)[DNA_VNEXT_FILE_ANALYSIS_KEY];
  if (!stored || typeof stored !== 'object') return null;
  const r = stored as DnaVnextProvenanceRecord;
  if (!r.vaultId || !r.watermarkLookupId || !r.rootAuthenticationHex16) return null;
  return r;
}

export async function loadProvenance(dnaRecordId: string): Promise<DnaVnextProvenanceRecord | null> {
  const row = await prisma.dnaRecord.findUnique({
    where: { id: dnaRecordId },
    select: { fileAnalysis: true },
  });
  return provenanceFromFileAnalysis(row?.fileAnalysis);
}

export async function findProvenanceByLookupId(params: {
  ownerUserId: string;
  lookupId: string;
}): Promise<DnaVnextProvenanceRecord | null> {
  const rows = await prisma.dnaRecord.findMany({
    where: { ownerUserId: params.ownerUserId },
    select: { id: true, fileAnalysis: true },
    take: 400,
    orderBy: { createdAt: 'desc' },
  });
  for (const row of rows) {
    const rec = provenanceFromFileAnalysis(row.fileAnalysis);
    if (rec?.watermarkLookupId === params.lookupId) return rec;
  }
  return null;
}

export function sha256Hex(buf: Buffer): string {
  return crypto.createHash('sha256').update(buf).digest('hex');
}
