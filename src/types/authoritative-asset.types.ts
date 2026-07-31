/**
 * Single immutable vault asset selected after candidate ranking.
 * All downstream investigation modules must consume only this record.
 */
import type { DeepCompareResult } from '../services/forensics/deep-vault-compare.service';
import type { VaultMatchResult } from '../services/forensics/vault-auto-match.service';
import type { RankedVaultCandidate } from './unified-investigation.types';
import type { VaultSimilarityVector } from '../services/forensics/vault-similarity-vector.service';
import type { LocalDnaSearchHit } from '../services/forensics/vault-local-dna-search.service';

export type AuthoritativeSelectionSource =
  | 'sha256_exact'
  | 'identity_hit'
  | 'vector_top'
  | 'local_patch'
  | 'deep_compare'
  | 'none';

export interface AuthoritativeAsset {
  readonly vaultId: string;
  readonly dnaRecordId: string;
  readonly ownerUserId: string;
  readonly ownerPinitId: string | null;
  readonly certificateId: string | null;
  readonly originalFilename: string;
  readonly storagePath: string | null;
  readonly selectionSource: AuthoritativeSelectionSource;
  readonly match: VaultMatchResult;
  readonly rankedCandidate: RankedVaultCandidate | null;
  readonly vector: VaultSimilarityVector | null;
  readonly deepCompare: DeepCompareResult | null;
  readonly localDnaHit: LocalDnaSearchHit | null;
}

export class VaultScopeViolationError extends Error {
  constructor(
    public readonly expectedVaultId: string,
    public readonly actualVaultId: string,
    public readonly context: string,
  ) {
    super(
      `[AuthoritativeAsset] Vault scope violation in ${context}: expected ${expectedVaultId.slice(0, 8)}…, got ${actualVaultId.slice(0, 8)}…`,
    );
    this.name = 'VaultScopeViolationError';
  }
}
