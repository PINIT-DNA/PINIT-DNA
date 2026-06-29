/**
 * Phase 2 — OCR DNA layer (generate at upload, store in enhancement bundle).
 * Reuses existing OcrService (Tesseract.js).
 */
import crypto from 'crypto';
import { isPhase2Active, dnaPhase2 } from '../../config/dna-phase2';
import { OcrService } from '../ocr/ocr.service';
import { simHash64, sha256 } from '../engines/base/text-utils';
import type { OcrDnaData } from '../../types/dna-enhancements.types';

const ocrService = new OcrService();

function layoutFingerprint(text: string): string {
  const lines = text.split('\n').filter((l) => l.trim());
  const profile = lines.slice(0, 50).map((l) => `${l.trim().length}:${l.split(/\s+/).length}`);
  return sha256(profile.join('|')).slice(0, 32);
}

function semanticFingerprint(text: string): string {
  const words = text.toLowerCase().match(/[a-z0-9]{3,}/g) ?? [];
  const top = [...new Set(words)].sort().slice(0, 100);
  return sha256(top.join(' ')).slice(0, 32);
}

export async function generateOcrDna(buffer: Buffer, mimeType: string): Promise<OcrDnaData | undefined> {
  if (!isPhase2Active() || !dnaPhase2.ocr) return undefined;

  const result = await ocrService.extractText(buffer, mimeType);
  if (!result.success || !result.text.trim()) return undefined;

  const text = result.text.slice(0, dnaPhase2.maxOcrChars);
  return {
    ocrSha256: crypto.createHash('sha256').update(text).digest('hex'),
    ocrSimHash: simHash64(text),
    semanticFingerprint: semanticFingerprint(text),
    layoutFingerprint: layoutFingerprint(text),
    confidence: result.confidence,
    wordCount: result.wordCount,
  };
}

export function verifyOcrDna(probe: OcrDnaData, stored: OcrDnaData): number {
  const scores: number[] = [];
  if (probe.ocrSha256 && stored.ocrSha256) {
    scores.push(probe.ocrSha256 === stored.ocrSha256 ? 1 : 0);
  }
  if (probe.ocrSimHash && stored.ocrSimHash) {
    scores.push(hammingHex(probe.ocrSimHash, stored.ocrSimHash, 64));
  }
  if (probe.semanticFingerprint && stored.semanticFingerprint) {
    scores.push(probe.semanticFingerprint === stored.semanticFingerprint ? 1 : 0.5);
  }
  if (probe.layoutFingerprint && stored.layoutFingerprint) {
    scores.push(probe.layoutFingerprint === stored.layoutFingerprint ? 1 : 0.6);
  }
  if (!scores.length) return 0;
  return scores.reduce((a, b) => a + b, 0) / scores.length;
}

function hammingHex(a: string, b: string, bits: number): number {
  if (a.length !== b.length) return 0;
  let dist = 0;
  for (let i = 0; i < a.length; i++) {
    const xor = parseInt(a[i]!, 16) ^ parseInt(b[i]!, 16);
    dist += ((xor >> 3) & 1) + ((xor >> 2) & 1) + ((xor >> 1) & 1) + (xor & 1);
  }
  return Math.max(0, 1 - dist / bits);
}
