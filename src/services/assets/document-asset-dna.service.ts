/**
 * Document Asset DNA — reuses UniversalFileRouter / existing document engines + OCR.
 */
import crypto from 'crypto';
import { prisma } from '../../lib/prisma';
import { logger } from '../../lib/logger';

export interface DocumentAssetDnaResult {
  engine: 'document-asset-dna';
  contentHash: string;
  structureHash: string;
  metadataHash: string;
  ocrTextHash?: string;
  ocrWordCount?: number;
  mimeType: string;
  sizeBytes: number;
}

function structureSketch(buffer: Buffer, mimeType: string): string {
  const head = buffer.subarray(0, Math.min(buffer.length, 64 * 1024));
  const tail = buffer.length > 64 * 1024
    ? buffer.subarray(buffer.length - Math.min(16 * 1024, buffer.length))
    : Buffer.alloc(0);
  return crypto
    .createHash('sha256')
    .update(mimeType)
    .update(String(buffer.length))
    .update(head)
    .update(tail)
    .digest('hex');
}

export async function buildDocumentAssetDna(opts: {
  buffer: Buffer;
  mimeType: string;
  originalFilename: string;
  dnaRecordId?: string | null;
}): Promise<DocumentAssetDnaResult> {
  const contentHash = crypto.createHash('sha256').update(opts.buffer).digest('hex');
  const structureHash = structureSketch(opts.buffer, opts.mimeType);
  const metadataHash = crypto
    .createHash('sha256')
    .update(JSON.stringify({
      name: opts.originalFilename,
      mime: opts.mimeType,
      size: opts.buffer.length,
    }))
    .digest('hex');

  let ocrTextHash: string | undefined;
  let ocrWordCount: number | undefined;
  if (opts.dnaRecordId) {
    try {
      const ocr = await prisma.ocrRecord.findUnique({
        where: { dnaRecordId: opts.dnaRecordId },
        select: { extractedText: true, wordCount: true },
      });
      if (ocr?.extractedText) {
        ocrTextHash = crypto.createHash('sha256').update(ocr.extractedText).digest('hex');
        ocrWordCount = ocr.wordCount ?? undefined;
      }
    } catch (err) {
      logger.warn('[DocumentAssetDna] OCR lookup skipped', { error: String(err) });
    }
  }

  return {
    engine: 'document-asset-dna',
    contentHash,
    structureHash,
    metadataHash,
    ocrTextHash,
    ocrWordCount,
    mimeType: opts.mimeType,
    sizeBytes: opts.buffer.length,
  };
}

export function compareDocumentAssetDna(
  a: Partial<DocumentAssetDnaResult>,
  b: Partial<DocumentAssetDnaResult>,
): { similarity: number; reasons: string[] } {
  const reasons: string[] = [];
  let score = 0;
  if (a.contentHash && a.contentHash === b.contentHash) {
    score += 0.7;
    reasons.push('Exact content hash');
  } else if (a.structureHash && a.structureHash === b.structureHash) {
    score += 0.35;
    reasons.push('Structure hash match');
  }
  if (a.metadataHash && a.metadataHash === b.metadataHash) {
    score += 0.1;
    reasons.push('Metadata hash match');
  }
  if (a.ocrTextHash && a.ocrTextHash === b.ocrTextHash) {
    score += 0.2;
    reasons.push('OCR text hash match');
  }
  return { similarity: Math.min(1, score), reasons };
}
