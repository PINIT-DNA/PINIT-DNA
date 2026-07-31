/**
 * Bridge leakVerify (TEP / embedded identity / export hash) into enterprise
 * authoritativeAsset before Acceptance / Top Candidate selection.
 *
 * Protected Download embeds TEP that leakedFileVerify finds, but enterprise
 * ranking historically ignored it — allowing mid-band visual lookalikes (~58%)
 * to become Top Candidate for an untampered protected re-upload.
 */
import { prisma } from '../../lib/prisma';
import { logger } from '../../lib/logger';
import { buildAuthoritativeAsset } from './authoritative-asset.service';
import type { EnterpriseRecoveryResult } from './enterprise-recovery-pipeline.service';
import type { LeakedFileVerifyResult } from './leaked-file-verify.service';
import type { VaultMatchResult } from './vault-auto-match.service';
import type { LeakDetectionMethod } from './leaked-file-verify.service';
import type { FusionResult } from './confidence-fusion-engine.service';

const STRONG_METHODS = new Set<LeakDetectionMethod>([
  'TEP_EXPORT',
  'EMBEDDED_IDENTITY',
  'EXACT_HASH',
  'WATERMARK',
  'PINIT_VAULT_SIGNATURE',
]);

export function isStrongLeakIdentity(leak: LeakedFileVerifyResult): boolean {
  if (!leak.found || !leak.identity?.dnaId) return false;
  if (!leak.detectionMethod || !STRONG_METHODS.has(leak.detectionMethod)) return false;
  return (leak.confidence ?? 0) >= 85;
}

/**
 * Ensure vaultId is present (Protected Download watermark path may only carry dnaId).
 */
export async function ensureLeakVaultId(
  leak: LeakedFileVerifyResult,
): Promise<LeakedFileVerifyResult> {
  if (!leak.found || !leak.identity?.dnaId) return leak;
  if (leak.identity.vaultId) return leak;
  const vault = await prisma.vaultRecord.findFirst({
    where: { dnaRecordId: leak.identity.dnaId },
    select: { id: true },
  });
  if (!vault) return leak;
  return {
    ...leak,
    identity: { ...leak.identity, vaultId: vault.id },
  };
}

/** Minimal enterprise shell so TEP / Protected Download can promote without waiting on slow DNA. */
export function emptyEnterpriseForLeakPromote(): EnterpriseRecoveryResult {
  const fusion: FusionResult = {
    ownershipConfidence: 0,
    retrievalConfidence: 0,
    identityConfidence: 0,
    ownershipVerificationConfidence: 0,
    trustScore: 0,
    highConfidence: false,
    forensicVerdict: 'NO_SIGNATURE',
    fusionMode: 'enterprise',
    breakdown: [],
  };
  return {
    match: null,
    probableMatch: null,
    verifiedCandidate: null,
    bestCandidate: null,
    authoritativeAsset: null,
    reportState: 'NO_SIGNATURE',
    reportStateReason: 'Awaiting leak-verify promotion',
    candidates: [],
    fusion,
    stages: [{
      stage: 'leak_verify_fast_path',
      status: 'skipped',
      detail: 'Heavy recovery deferred — strong TEP/identity found',
    }],
    variantCount: 1,
    manifestRecovered: false,
    identityTokenRecovered: false,
    watermarkRecovered: false,
    identified: false,
    highConfidence: false,
    recoveredSignals: [],
    deepCompareResults: [],
    certificateId: null,
    ownerShortId: null,
    tamperingSummary: '',
    bestDeepCompare: null,
    auditContext: {
      vectors: [],
      vaultRecordIds: [],
      selectionSteps: [],
      identityHit: null,
      localDnaHit: null,
    },
  };
}

/**
 * When leakVerify has hard identity for vault X and enterprise locked a different
 * (or weak) vault Y, force authoritativeAsset → X with identity_hit + watermark signal
 * so Acceptance can VERIFIED via instant watermark proof.
 */
export async function promoteLeakVerifyToAuthoritative(
  enterprise: EnterpriseRecoveryResult,
  leakVerifyIn: LeakedFileVerifyResult,
  ownerUserId: string,
): Promise<EnterpriseRecoveryResult> {
  const leakVerify = await ensureLeakVaultId(leakVerifyIn);
  if (!isStrongLeakIdentity(leakVerify) || !leakVerify.identity?.vaultId) return enterprise;

  const vaultId = leakVerify.identity!.vaultId!;
  const dnaRecordId = leakVerify.identity!.dnaId!;
  const conf = Math.round(leakVerify.confidence ?? 97);

  const vault = await prisma.vaultRecord.findFirst({
    where: {
      id: vaultId,
      dnaRecord: { ownerUserId },
    },
    select: { id: true, dnaRecordId: true },
  });
  if (!vault || vault.dnaRecordId !== dnaRecordId) {
    logger.warn('[LeakVerifyBridge] Strong leak identity rejected — vault not in tenant or DNA mismatch', {
      vaultId: vaultId.slice(0, 8),
      dnaRecordId: dnaRecordId.slice(0, 8),
      method: leakVerify.detectionMethod,
    });
    return enterprise;
  }

  const current = enterprise.authoritativeAsset;
  const alreadyLocked = current?.vaultId === vaultId
    && (current.selectionSource === 'identity_hit' || current.selectionSource === 'sha256_exact');
  if (alreadyLocked) {
    // Still inject watermark signal if missing so Acceptance can VERIFIED
    if (enterprise.watermarkRecovered) return enterprise;
  }

  const shouldReplace = !current
    || current.vaultId !== vaultId
    || current.selectionSource === 'vector_top'
    || current.selectionSource === 'deep_compare'
    || current.selectionSource === 'none'
    || (current.deepCompare != null
      && current.deepCompare.overallConfidenceScore < 90
      && current.selectionSource !== 'identity_hit'
      && current.selectionSource !== 'sha256_exact');

  if (!shouldReplace && alreadyLocked && enterprise.watermarkRecovered) {
    return enterprise;
  }

  const match: VaultMatchResult = {
    tier: 2,
    method: `Leak verify (${leakVerify.detectionMethod})`,
    dnaRecordId,
    vaultId,
    ownerUserId: leakVerify.identity?.ownerUserId ?? ownerUserId,
    confidence: String(conf),
    visualSimilarity: Math.min(1, conf / 100),
  };

  let authoritativeAsset = current;
  if (shouldReplace || !current || current.vaultId !== vaultId) {
    authoritativeAsset = await buildAuthoritativeAsset({
      selection: { match, source: 'identity_hit' },
      candidates: enterprise.candidates ?? [],
      vectors: enterprise.auditContext?.vectors ?? [],
      deepCompareResults: enterprise.deepCompareResults ?? [],
      localDnaHit: enterprise.auditContext?.localDnaHit ?? null,
      ownerUserId,
    });
  }

  const wmSignal = {
    stage: 'watermark_tep_leak_verify',
    score: conf,
    recovered: true,
    detail: leakVerify.message || `Recovered via ${leakVerify.detectionMethod}`,
  };

  const prevSignals = enterprise.recoveredSignals ?? [];
  const recoveredSignals = prevSignals.some((s) => /watermark|identity_token|manifest|tep_leak/i.test(s.stage) && s.recovered)
    ? prevSignals.map((s) => (
      /watermark|identity_token|manifest|tep_leak/i.test(s.stage)
        ? { ...s, recovered: true, score: Math.max(s.score, conf) }
        : s
    ))
    : [...prevSignals, wmSignal];

  const fusion = {
    ...enterprise.fusion,
    ownershipConfidence: Math.max(
      enterprise.fusion?.ownershipConfidence ?? 0,
      conf,
    ),
    ownershipVerificationConfidence: Math.max(
      enterprise.fusion?.ownershipVerificationConfidence ?? 0,
      conf,
    ),
    identityConfidence: Math.max(enterprise.fusion?.identityConfidence ?? 0, conf),
    retrievalConfidence: Math.max(enterprise.fusion?.retrievalConfidence ?? 0, conf),
    trustScore: Math.max(enterprise.fusion?.trustScore ?? 0, conf),
    highConfidence: conf >= 90,
    forensicVerdict: (leakVerify.tampered
      ? 'ORIGINAL_FOUND_PARTIAL'
      : 'ORIGINAL_VERIFIED') as typeof enterprise.fusion.forensicVerdict,
  };

  logger.info('[LeakVerifyBridge] Promoted leak identity to authoritative asset', {
    method: leakVerify.detectionMethod,
    vaultId: vaultId.slice(0, 8),
    dnaRecordId: dnaRecordId.slice(0, 8),
    previousVault: current?.vaultId?.slice(0, 8) ?? null,
    previousSource: current?.selectionSource ?? null,
    confidence: conf,
  });

  return {
    ...enterprise,
    identified: true,
    highConfidence: conf >= 90,
    watermarkRecovered: true,
    match,
    verifiedCandidate: match,
    probableMatch: match,
    bestCandidate: match,
    authoritativeAsset,
    recoveredSignals,
    fusion,
    reportState: leakVerify.valid && !leakVerify.tampered ? 'VERIFIED' : enterprise.reportState,
    reportStateReason: leakVerify.message,
    auditContext: enterprise.auditContext
      ? {
          ...enterprise.auditContext,
          identityHit: match,
        }
      : {
          vectors: [],
          vaultRecordIds: [vaultId],
          selectionSteps: [],
          identityHit: match,
          localDnaHit: null,
        },
  };
}
