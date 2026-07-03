/**
 * Authoritative Asset — single immutable winner after candidate ranking.
 * Downstream modules (certificate, DNA compare, fusion, report) must use only this.
 */
import { prisma } from '../../lib/prisma';
import { logger } from '../../lib/logger';
import { certificateService } from '../certificates/certificate.service';
import { vaultCandidateRankingService } from './vault-candidate-ranking.service';
import type { DeepCompareResult } from './deep-vault-compare.service';
import type { VaultMatchResult } from './vault-auto-match.service';
import type { VaultSimilarityVector } from './vault-similarity-vector.service';
import type { LocalDnaSearchHit } from './vault-local-dna-search.service';
import type { RankedVaultCandidate } from '../../types/unified-investigation.types';
import type {
  AuthoritativeAsset,
  AuthoritativeSelectionSource,
} from '../../types/authoritative-asset.types';
import { VaultScopeViolationError } from '../../types/authoritative-asset.types';

export { VaultScopeViolationError } from '../../types/authoritative-asset.types';

function deepCompareToMatch(deep: DeepCompareResult, ownerUserId: string): VaultMatchResult {
  return {
    tier: 4,
    method: `15-layer DNA compare (${deep.overallConfidenceScore}%)`,
    dnaRecordId: deep.dnaRecordId,
    vaultId: deep.vaultId,
    ownerUserId,
    confidence: String(deep.overallConfidenceScore),
    visualSimilarity: deep.overallConfidenceScore / 100,
  };
}

function localHitToMatch(hit: LocalDnaSearchHit, score: number): VaultMatchResult {
  return {
    tier: 3,
    method: `Local patch DNA (${hit.patchMatchCount} patches)`,
    dnaRecordId: hit.dnaRecordId,
    vaultId: hit.vaultId,
    ownerUserId: hit.ownerUserId,
    confidence: String(score),
    visualSimilarity: (hit.orbRefineScore || score) / 100,
  };
}

export interface SelectAuthoritativeInput {
  identityHit: VaultMatchResult | null;
  candidates: RankedVaultCandidate[];
  localDnaHit: LocalDnaSearchHit | null;
  localDnaScore: number;
  deepCompare: DeepCompareResult | null;
  isExactVaultMatch: boolean;
  ownerUserId: string;
}

export interface SelectAuthoritativeResult {
  match: VaultMatchResult;
  source: AuthoritativeSelectionSource;
}

/**
 * Select the single winning vault after ranking completes.
 * Priority: SHA exact / identity hit → vector top → local patch → deep compare.
 * No post-selection overrides.
 */
export function selectAuthoritativeMatch(
  input: SelectAuthoritativeInput,
): SelectAuthoritativeResult | null {
  if (input.isExactVaultMatch && input.identityHit) {
    return { match: input.identityHit, source: 'sha256_exact' };
  }

  if (input.identityHit) {
    return { match: input.identityHit, source: 'identity_hit' };
  }

  const topCandidate = input.candidates[0];
  if (topCandidate && topCandidate.compositeScore >= 38) {
    return {
      match: vaultCandidateRankingService.toVaultMatch(topCandidate),
      source: 'vector_top',
    };
  }

  if (input.localDnaHit && input.localDnaScore >= 38) {
    return {
      match: localHitToMatch(input.localDnaHit, input.localDnaScore),
      source: 'local_patch',
    };
  }

  if (input.deepCompare && input.deepCompare.overallConfidenceScore >= 30) {
    return {
      match: deepCompareToMatch(input.deepCompare, input.ownerUserId),
      source: 'deep_compare',
    };
  }

  return null;
}

/** Throws if a downstream service references a different vault than the authoritative asset. */
export function assertVaultScope(
  authoritativeVaultId: string,
  actualVaultId: string | null | undefined,
  context: string,
): void {
  if (!actualVaultId) return;
  if (actualVaultId !== authoritativeVaultId) {
    const err = new VaultScopeViolationError(authoritativeVaultId, actualVaultId, context);
    logger.error(err.message, { context, expected: authoritativeVaultId.slice(0, 8), actual: actualVaultId.slice(0, 8) });
    throw err;
  }
}

export function assertDnaScope(
  authoritativeDnaRecordId: string,
  actualDnaRecordId: string | null | undefined,
  context: string,
): void {
  if (!actualDnaRecordId) return;
  if (actualDnaRecordId !== authoritativeDnaRecordId) {
    throw new Error(
      `[AuthoritativeAsset] DNA scope violation in ${context}: expected ${authoritativeDnaRecordId.slice(0, 8)}…, got ${actualDnaRecordId.slice(0, 8)}…`,
    );
  }
}

export function vectorForVault(
  vectors: VaultSimilarityVector[],
  vaultId: string,
): VaultSimilarityVector | null {
  return vectors.find((v) => v.vaultId === vaultId) ?? null;
}

export function deepCompareForVault(
  results: DeepCompareResult[],
  vaultId: string,
): DeepCompareResult | null {
  return results.find((d) => d.vaultId === vaultId) ?? null;
}

export function candidateForVault(
  candidates: RankedVaultCandidate[],
  vaultId: string,
): RankedVaultCandidate | null {
  return candidates.find((c) => c.vaultId === vaultId) ?? null;
}

export interface BuildAuthoritativeInput {
  selection: SelectAuthoritativeResult;
  candidates: RankedVaultCandidate[];
  vectors: VaultSimilarityVector[];
  deepCompareResults: DeepCompareResult[];
  localDnaHit: LocalDnaSearchHit | null;
  ownerUserId: string;
}

/**
 * Load certificate, owner, filename, storage path — all from the same vault/DNA row.
 */
export async function buildAuthoritativeAsset(
  input: BuildAuthoritativeInput,
): Promise<AuthoritativeAsset> {
  const { match, source } = input.selection;
  const vaultId = match.vaultId;
  const dnaRecordId = match.dnaRecordId;

  const deepCompare = deepCompareForVault(input.deepCompareResults, vaultId);
  const vector = vectorForVault(input.vectors, vaultId);
  const rankedCandidate = candidateForVault(input.candidates, vaultId);
  const localDnaHit =
    input.localDnaHit?.vaultId === vaultId ? input.localDnaHit : null;

  const [vaultRow, dnaRow, owner] = await Promise.all([
    prisma.vaultRecord.findUnique({
      where: { id: vaultId },
      select: { encryptedFilePath: true, originalFileName: true, dnaRecordId: true },
    }),
    prisma.dnaRecord.findUnique({
      where: { id: dnaRecordId },
      select: { imageFilename: true, ownerUserId: true },
    }),
    prisma.user.findUnique({
      where: { id: match.ownerUserId },
      select: { shortId: true },
    }),
  ]);

  if (!vaultRow) {
    throw new Error(`[AuthoritativeAsset] Vault record not found: ${vaultId}`);
  }
  if (!dnaRow) {
    throw new Error(`[AuthoritativeAsset] DNA record not found: ${dnaRecordId}`);
  }
  assertDnaScope(dnaRecordId, vaultRow.dnaRecordId, 'buildAuthoritativeAsset:vaultDnaFk');

  const cert = await certificateService.findActiveForAsset({
    dnaRecordId,
    vaultId,
    ownerUserId: input.ownerUserId,
  });

  if (cert) {
    assertVaultScope(vaultId, cert.vaultId, 'buildAuthoritativeAsset:certificate');
    assertDnaScope(dnaRecordId, cert.dnaRecordId, 'buildAuthoritativeAsset:certificateDna');
  }

  const asset: AuthoritativeAsset = {
    vaultId,
    dnaRecordId,
    ownerUserId: dnaRow?.ownerUserId ?? match.ownerUserId,
    ownerPinitId: owner?.shortId ?? null,
    certificateId: cert?.certificateId ?? null,
    originalFilename: dnaRow?.imageFilename ?? vaultRow?.originalFileName ?? 'unknown',
    storagePath: vaultRow?.encryptedFilePath ?? null,
    selectionSource: source,
    match,
    rankedCandidate,
    vector,
    deepCompare,
    localDnaHit,
  };

  logger.info('[AuthoritativeAsset] Selected immutable winner', {
    vaultId: vaultId.slice(0, 8),
    dnaRecordId: dnaRecordId.slice(0, 8),
    certificateId: asset.certificateId?.slice(0, 12) ?? null,
    originalFilename: asset.originalFilename,
    source,
  });

  return Object.freeze(asset);
}

/** Guard for orchestrator / downstream services */
export function requireAuthoritativeAsset(
  asset: AuthoritativeAsset | null | undefined,
  context: string,
): AuthoritativeAsset {
  if (!asset) {
    throw new Error(`[AuthoritativeAsset] No authoritative asset in ${context}`);
  }
  return asset;
}
