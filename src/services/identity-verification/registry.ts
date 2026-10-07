/**
 * Adapter registry. To support a new document type: write an adapter in
 * adapters/ and add it to ADAPTERS. Nothing else in the pipeline changes.
 */
import type { IdentityDocumentType } from './types';
import { DETECTION_THRESHOLD, type Detection, type DocumentAdapter } from './adapters/adapter';
import { passportAdapter } from './adapters/passport';
import { aadhaarAdapter } from './adapters/aadhaar';
import { panAdapter } from './adapters/pan';
import { drivingLicenceAdapter } from './adapters/driving-licence';
import { voterIdAdapter } from './adapters/voter-id';
import { governmentIdAdapter } from './adapters/government-id';

const ADAPTERS: DocumentAdapter[] = [
  passportAdapter,
  aadhaarAdapter,
  panAdapter,
  drivingLicenceAdapter,
  voterIdAdapter,
  governmentIdAdapter,
];

export function adapterFor(type: IdentityDocumentType): DocumentAdapter | null {
  return ADAPTERS.find((a) => a.type === type) ?? null;
}

export function registeredTypes(): IdentityDocumentType[] {
  return ADAPTERS.map((a) => a.type);
}

export interface Classification {
  type: IdentityDocumentType | null;
  confidence: number;
  evidence: string[];
  /** Set when the document looks like a different type than the one declared. */
  declaredMismatch: { declared: IdentityDocumentType; looksLike: IdentityDocumentType } | null;
  scores: Array<{ type: IdentityDocumentType; score: number }>;
}

/** Margin by which another type must beat the declared one before we say "mismatch". */
const MISMATCH_MARGIN = 0.2;

export function classify(text: string, declared?: IdentityDocumentType | null): Classification {
  const detections: Array<{ adapter: DocumentAdapter; d: Detection }> = ADAPTERS.map((adapter) => ({ adapter, d: adapter.detect(text) }));
  const ranked = [...detections].sort((a, b) => b.d.score - a.d.score);
  const best = ranked[0]!;
  const scores = ranked.map(({ adapter, d }) => ({ type: adapter.type, score: +d.score.toFixed(2) }));
  const declaredHit = declared ? detections.find((x) => x.adapter.type === declared) : undefined;

  if (declaredHit && declaredHit.d.score >= DETECTION_THRESHOLD) {
    const mismatch = best.adapter.type !== declared && best.d.score - declaredHit.d.score >= MISMATCH_MARGIN
      ? { declared: declared!, looksLike: best.adapter.type }
      : null;
    return { type: declared!, confidence: declaredHit.d.score, evidence: declaredHit.d.evidence, declaredMismatch: mismatch, scores };
  }
  if (best.d.score >= DETECTION_THRESHOLD) {
    return {
      type: best.adapter.type,
      confidence: best.d.score,
      evidence: best.d.evidence,
      declaredMismatch: declared && declared !== best.adapter.type ? { declared, looksLike: best.adapter.type } : null,
      scores,
    };
  }
  return { type: null, confidence: best.d.score, evidence: best.d.evidence, declaredMismatch: null, scores };
}
