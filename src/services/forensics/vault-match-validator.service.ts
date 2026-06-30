/**
 * Vault match validation — prevents false positives from weak filename/heuristic matches.
 */
import type { VaultMatchResult } from './vault-auto-match.service';
import type { RankedVaultCandidate } from '../../types/unified-investigation.types';

export const CAMERA_SCAN_NAME_RE = /^(scan_|captured_|photo_|IMG_|image_)/i;

export function isCameraScanFileName(name: string): boolean {
  return CAMERA_SCAN_NAME_RE.test(name.trim());
}

const FORENSIC_SIGNALS = new Set([
  'cryptographic_hash',
  'perceptual_hash',
  'filename_exact',
  'semantic_dna',
  'identity_signature',
  'watermark',
  'manifest',
]);

/** Tier 1–2 identity, or tier 4 with strong visual DNA */
export function isTrustedVaultMatch(match: VaultMatchResult): boolean {
  if (match.tier === 1 || match.tier === 2) return true;
  if (match.tier === 4) {
    const vis = match.visualSimilarity ?? Number.parseInt(match.confidence, 10) / 100;
    return !Number.isNaN(vis) && vis >= 0.62;
  }
  // Tier 3 filename-only matches are never trusted without visual DNA
  return false;
}

export function isTrustedCandidate(candidate: RankedVaultCandidate): boolean {
  if (candidate.compositeScore < 55) return false;
  return candidate.signals.some((s) => FORENSIC_SIGNALS.has(s) || s.startsWith('variant:'));
}

export function candidateHasVisualSignal(candidate: RankedVaultCandidate): boolean {
  return candidate.signals.includes('perceptual_hash')
    || candidate.signals.includes('cryptographic_hash')
    || candidate.compositeScore >= 75;
}

/** After 15-layer compare — reject wrong vault pairing */
export function isAcceptedAfterDnaCompare(
  match: VaultMatchResult,
  overallConfidenceScore: number,
  classification: string,
  isCameraScan: boolean,
): boolean {
  if (match.tier === 1) return true;
  if (match.tier === 2) return overallConfidenceScore >= 20 || classification !== 'DIFFERENT';
  if (match.tier === 4) {
    const min = isCameraScan ? 40 : 50;
    return overallConfidenceScore >= min && classification !== 'DIFFERENT';
  }
  return overallConfidenceScore >= 75 && classification === 'DNA_MATCH';
}

export function explainMatchBasis(match: VaultMatchResult): string {
  if (match.tier === 1) return 'Cryptographic SHA-256 exact match';
  if (match.tier === 2) return 'Forensic identity — watermark, signature, token, or manifest';
  if (match.tier === 4) return `Visual DNA perceptual hash (${match.confidence}% similar)`;
  return match.method;
}

export function tamperStatusFromCompare(
  isIdentical: boolean,
  overallConfidenceScore: number,
  classification: string,
  tamperingDetected: boolean,
): { tampered: boolean; label: string } {
  if (isIdentical) return { tampered: false, label: 'INTACT' };
  if (classification === 'DNA_MATCH' && overallConfidenceScore >= 85) {
    return { tampered: false, label: 'MINOR_VARIANCE' };
  }
  if (tamperingDetected || classification === 'DIFFERENT' || overallConfidenceScore < 35) {
    return { tampered: true, label: 'TAMPERED' };
  }
  if (overallConfidenceScore < 55) {
    return { tampered: true, label: 'LIKELY_MODIFIED' };
  }
  return { tampered: !isIdentical, label: isIdentical ? 'INTACT' : 'MODIFIED' };
}
