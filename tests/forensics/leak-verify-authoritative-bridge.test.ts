import {
  isStrongLeakIdentity,
  promoteLeakVerifyToAuthoritative,
} from '../../src/services/forensics/leak-verify-authoritative-bridge.service';
import type { EnterpriseRecoveryResult } from '../../src/services/forensics/enterprise-recovery-pipeline.service';
import type { LeakedFileVerifyResult } from '../../src/services/forensics/leaked-file-verify.service';

jest.mock('../../src/lib/prisma', () => ({
  prisma: {
    vaultRecord: {
      findFirst: jest.fn(),
    },
  },
}));

jest.mock('../../src/services/forensics/authoritative-asset.service', () => ({
  buildAuthoritativeAsset: jest.fn(async ({ selection }: { selection: { match: unknown; source: string } }) => ({
    vaultId: (selection.match as { vaultId: string }).vaultId,
    dnaRecordId: (selection.match as { dnaRecordId: string }).dnaRecordId,
    ownerUserId: 'user-1',
    ownerPinitId: 'PINIT-TEST',
    certificateId: null,
    originalFilename: 'han.webp',
    storagePath: null,
    selectionSource: selection.source,
    match: selection.match,
    rankedCandidate: null,
    vector: null,
    deepCompare: null,
    localDnaHit: null,
  })),
}));

import { prisma } from '../../src/lib/prisma';

function baseEnterprise(overrides: Partial<EnterpriseRecoveryResult> = {}): EnterpriseRecoveryResult {
  return {
    match: null,
    probableMatch: {
      tier: 4,
      method: 'lookalike',
      dnaRecordId: 'dna-wrong',
      vaultId: 'vault-wrong',
      ownerUserId: 'user-1',
      confidence: '58',
      visualSimilarity: 0.58,
    },
    verifiedCandidate: null,
    bestCandidate: null,
    reportState: 'POSSIBLE',
    reportStateReason: 'mid-band',
    candidates: [],
    fusion: {
      ownershipConfidence: 20,
      retrievalConfidence: 58,
      identityConfidence: 40,
      ownershipVerificationConfidence: 20,
      trustScore: 40,
      highConfidence: false,
      forensicVerdict: 'POSSIBLE_ASSET',
      fusionMode: 'enterprise',
      breakdown: [],
    },
    stages: [],
    variantCount: 0,
    manifestRecovered: false,
    identityTokenRecovered: false,
    watermarkRecovered: false,
    identified: false,
    highConfidence: false,
    recoveredSignals: [],
    deepCompareResults: [],
    certificateId: null,
    ownerShortId: null,
    tamperingSummary: null,
    bestDeepCompare: null,
    authoritativeAsset: {
      vaultId: 'vault-wrong',
      dnaRecordId: 'dna-wrong',
      ownerUserId: 'user-1',
      ownerPinitId: null,
      certificateId: null,
      originalFilename: 'Digital Marketing.webp',
      storagePath: null,
      selectionSource: 'deep_compare',
      match: {
        tier: 4,
        method: 'lookalike',
        dnaRecordId: 'dna-wrong',
        vaultId: 'vault-wrong',
        ownerUserId: 'user-1',
        confidence: '58',
      },
      rankedCandidate: null,
      vector: null,
      deepCompare: {
        vaultId: 'vault-wrong',
        dnaRecordId: 'dna-wrong',
        overallConfidenceScore: 58,
        classification: 'SIMILAR',
        tamperingDetected: false,
        matchedLayerCount: 2,
        totalLayers: 15,
        layerComparisons: [],
      },
      localDnaHit: null,
    },
    ...overrides,
  } as EnterpriseRecoveryResult;
}

describe('leak-verify-authoritative-bridge', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('detects strong TEP / protected-download identity', () => {
    const leak: LeakedFileVerifyResult = {
      found: true,
      valid: true,
      tampered: false,
      detectionMethod: 'TEP_EXPORT',
      confidence: 97,
      message: 'Protected Download',
      identity: { vaultId: 'vault-han', dnaId: 'dna-han', ownerUserId: 'user-1' },
    };
    expect(isStrongLeakIdentity(leak)).toBe(true);
  });

  it('promotes TEP vault over mid-band lookalike authoritative asset', async () => {
    (prisma.vaultRecord.findFirst as jest.Mock).mockResolvedValue({
      id: 'vault-han',
      dnaRecordId: 'dna-han',
    });

    const leak: LeakedFileVerifyResult = {
      found: true,
      valid: true,
      tampered: false,
      detectionMethod: 'TEP_EXPORT',
      confidence: 97,
      message: 'Protected Download TEP',
      identity: { vaultId: 'vault-han', dnaId: 'dna-han', ownerUserId: 'user-1' },
    };

    const result = await promoteLeakVerifyToAuthoritative(baseEnterprise(), leak, 'user-1');

    expect(result.authoritativeAsset?.vaultId).toBe('vault-han');
    expect(result.authoritativeAsset?.selectionSource).toBe('identity_hit');
    expect(result.watermarkRecovered).toBe(true);
    expect(result.identified).toBe(true);
    expect(result.recoveredSignals.some((s) => s.recovered && s.score >= 90)).toBe(true);
  });

  it('does not promote when vault is outside tenant', async () => {
    (prisma.vaultRecord.findFirst as jest.Mock).mockResolvedValue(null);
    const leak: LeakedFileVerifyResult = {
      found: true,
      valid: true,
      detectionMethod: 'TEP_EXPORT',
      confidence: 97,
      message: 'x',
      identity: { vaultId: 'vault-other', dnaId: 'dna-other' },
    };
    const enterprise = baseEnterprise();
    const result = await promoteLeakVerifyToAuthoritative(enterprise, leak, 'user-1');
    expect(result.authoritativeAsset?.vaultId).toBe('vault-wrong');
  });
});
