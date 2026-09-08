import { logger } from '../../lib/logger';
import type { ImageCompositionBreakdown } from '../../types/investigation-composition.types';
import type { BlockDnaInvestigationResult } from '../../types/block-dna.types';
import type { FragmentReuseFinding } from '../../types/unified-investigation.types';
import { investigateBlockDna } from './investigate';

export async function enrichInvestigationWithBlockDna(params: {
  composition: ImageCompositionBreakdown;
  probeBuffer?: Buffer;
  probeMimeType?: string;
  vaultBuffer?: Buffer;
  vaultImageId?: string;
  vaultMatchId?: string;
  investigationId: string;
  retrievalScore: number;
  fragmentFindings?: FragmentReuseFinding[];
}): Promise<{ composition: ImageCompositionBreakdown; blockDna: BlockDnaInvestigationResult | null }> {
  if (
    !params.probeBuffer
    || !params.vaultBuffer
    || !params.vaultImageId
    || !params.vaultMatchId
    || !params.probeMimeType?.startsWith('image/')
  ) {
    return { composition: params.composition, blockDna: null };
  }
  try {
    const blockDna = await investigateBlockDna({
      probeBuffer: params.probeBuffer,
      vaultBuffer: params.vaultBuffer,
      vaultImageId: params.vaultImageId,
      vaultMatchId: params.vaultMatchId,
      investigationId: params.investigationId,
      retrievalScore: params.retrievalScore,
      fragmentFindings: params.fragmentFindings,
    });
    return {
      composition: params.composition,
      blockDna,
    };
  } catch (err) {
    logger.warn('Block DNA investigation skipped', { error: String(err) });
    return { composition: params.composition, blockDna: null };
  }
}
