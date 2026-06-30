/**
 * Vault match validation — prevents false positives from weak filename/heuristic matches.
 */
import type { VaultMatchResult } from './vault-auto-match.service';
import type { RankedVaultCandidate } from '../../types/unified-investigation.types';

export const CAMERA_SCAN_NAME_RE = /^(scan_|captured_|photo_|IMG_|image_|WhatsApp_)/i;

export function isCameraScanFileName(name: string): boolean {
  return CAMERA_SCAN_NAME_RE.test(name.trim());
}

const FORENSIC_SIGNALS = new Set([
  'cryptographic_hash',
  'perceptual_hash',
  'structural_fingerprint',
  'local_features',
  'filename_exact',
  'semantic_dna',
  'identity_signature',
  'watermark',
  'manifest',
]);

const LOCAL_FEATURE_SIGNALS = new Set(['local_features', 'opencv_orb', 'orb_akaze', 'local_patch_dna', 'fragment_recovery']);

function matchScore(match: VaultMatchResult): number {
  const parsed = Number.parseInt(match.confidence, 10);
  if (!Number.isNaN(parsed)) return parsed;
  return Math.round((match.visualSimilarity ?? 0) * 100);
}

/** Tier 1–2 identity, or tier 4 with strong visual DNA */
export function isTrustedVaultMatch(match: VaultMatchResult): boolean {
  if (match.tier === 1 || match.tier === 2) return true;
  if (match.tier === 4) {
    const score = matchScore(match);
    const vis = match.visualSimilarity ?? score / 100;
    return score >= 62 || (!Number.isNaN(vis) && vis >= 0.62);
  }
  if (match.tier === 3 && match.method.includes('Local patch DNA')) {
    return matchScore(match) >= 55;
  }
  // Tier 3 filename-only matches are never trusted without visual DNA
  return false;
}

/** Strong vault-wide search hit — structural, ORB, or perceptual at high composite */
export function isStrongVaultCandidate(candidate: RankedVaultCandidate): boolean {
  if (candidate.compositeScore < 80) return false;
  return candidateHasVisualSignal(candidate);
}

export function isTrustedCandidate(candidate: RankedVaultCandidate): boolean {
  if (candidate.compositeScore < 55) return false;
  return candidate.signals.some((s) => FORENSIC_SIGNALS.has(s) || s.startsWith('variant:'));
}

export function candidateHasVisualSignal(candidate: RankedVaultCandidate): boolean {
  return candidate.signals.includes('perceptual_hash')
    || candidate.signals.includes('cryptographic_hash')
    || candidate.signals.includes('structural_fingerprint')
    || candidate.signals.some((s) => LOCAL_FEATURE_SIGNALS.has(s))
    || candidate.compositeScore >= 75;
}

/** Upgrade weak deep-compare pairing when vault-wide search found a stronger forensic hit */
export function shouldUpgradeMatchFromCandidate(
  candidate: RankedVaultCandidate,
  match: VaultMatchResult | null,
): boolean {
  if (!match || !isStrongVaultCandidate(candidate)) return false;
  const ms = matchScore(match);
  if (isTrustedVaultMatch(match) && ms >= candidate.compositeScore) return false;
  if (candidate.vaultId === match.vaultId) {
    return candidate.compositeScore >= 80 && ms < candidate.compositeScore - 8;
  }
  return candidate.compositeScore >= ms + 12;
}

/** After 15-layer compare — reject wrong vault pairing */
export function isAcceptedAfterDnaCompare(
  match: VaultMatchResult,
  overallConfidenceScore: number,
  classification: string,
  isCameraScan: boolean,
): boolean {
  const vaultSearchScore = matchScore(match);
  if (match.tier === 1) return true;
  if (match.tier === 2) return overallConfidenceScore >= 20 || classification !== 'DIFFERENT';
  if (match.tier === 4) {
    // Strong vault-wide structural/ORB hit — accept transformed captures (screenshots, photos)
    if (vaultSearchScore >= 85 && classification !== 'DIFFERENT') return true;
    const min = isCameraScan ? 32 : 42;
    return overallConfidenceScore >= min && classification !== 'DIFFERENT';
  }
  if (match.tier === 3 && match.method.includes('Local patch DNA')) {
    return vaultSearchScore >= 55 && classification !== 'DIFFERENT';
  }
  return overallConfidenceScore >= 75 && classification === 'DNA_MATCH';
}

export function explainMatchBasis(match: VaultMatchResult): string {
  if (match.tier === 1) return 'Cryptographic SHA-256 exact match';
  if (match.tier === 2) return 'Forensic identity — watermark, signature, token, or manifest';
  if (match.tier === 4) return `Visual DNA perceptual hash (${match.confidence}% similar)`;
  if (match.tier === 3 && match.method.includes('Local patch DNA')) {
    return `Local patch DNA fragment recovery (${match.confidence}% patch votes)`;
  }
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
