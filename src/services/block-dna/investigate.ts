import { decodeImageForSpatialAuth } from '../spatial/image-decode';
import { blockDnaConfig } from '../../config/block-dna';
import type { BlockDnaInvestigationResult } from '../../types/block-dna.types';
import type { FragmentReuseFinding } from '../../types/unified-investigation.types';
import { buildNarrative } from './classify';
import {
  compareAlignedBlocks,
  fragmentScaleAlignment,
  identityAlignment,
  locateTopLeftOffset,
  offsetAlignment,
  packHover,
  summarizeCells,
  vaultTagsFromRgb,
  vaultTagsFromStored,
} from './compare';
import { generateManifestFromRgb } from './manifest';
import { persistBlockDnaManifest, loadStoredBlockDnaManifest } from './store';
import type { Alignment } from './compare';

const SMALL_GRID_CELLS = 2048;

function emptyResult(partial: Partial<BlockDnaInvestigationResult> & {
  investigationId: string;
  imageId?: string;
  vaultMatchId?: string;
}): BlockDnaInvestigationResult {
  const labels = '';
  const packed = {
    rows: 0,
    cols: 0,
    labels,
    vaultDnaHex16: '',
    calcDnaHex16: '',
    pixelSimPct: '',
    structSimPct: '',
    dnaOk: '',
  };
  return {
    available: false,
    imageId: partial.imageId ?? '',
    vaultMatchId: partial.vaultMatchId ?? '',
    investigationId: partial.investigationId,
    overallMatch: 0,
    originalBlockPercent: 0,
    modifiedBlockPercent: 0,
    unknownBlockPercent: 0,
    totalBlocks: 0,
    matchedBlocks: 0,
    modifiedBlocks: 0,
    unknownBlocks: 0,
    algorithm: blockDnaConfig.algorithm,
    blockSize: blockDnaConfig.blockSize,
    authenticationStatus: partial.authenticationStatus ?? 'UNAVAILABLE',
    narrative: partial.narrative ?? buildNarrative({
      originalPct: 0,
      modifiedPct: 0,
      unknownPct: 0,
      available: false,
      authStatus: partial.authenticationStatus ?? 'UNAVAILABLE',
    }),
    probeWidth: 0,
    probeHeight: 0,
    vaultWidth: 0,
    vaultHeight: 0,
    blockGrid: { rows: 0, cols: 0, labels: '' },
    packed,
  };
}

export async function enrollBlockDnaForVaultImage(params: {
  imageBuffer: Buffer;
  dnaRecordId: string;
}): Promise<void> {
  if (!blockDnaConfig.enabled) return;
  const decoded = await decodeImageForSpatialAuth(params.imageBuffer);
  const { stored } = generateManifestFromRgb({
    rgb: decoded.rgb,
    width: decoded.width,
    height: decoded.height,
    imageId: params.dnaRecordId,
  });
  await persistBlockDnaManifest(params.dnaRecordId, stored);
}

export async function investigateBlockDna(params: {
  probeBuffer: Buffer;
  vaultBuffer: Buffer;
  vaultImageId: string;
  vaultMatchId: string;
  investigationId: string;
  retrievalScore: number;
  fragmentFindings?: FragmentReuseFinding[];
}): Promise<BlockDnaInvestigationResult> {
  if (!blockDnaConfig.enabled) {
    return emptyResult({
      investigationId: params.investigationId,
      authenticationStatus: 'DISABLED',
    });
  }

  if (!(params.retrievalScore >= blockDnaConfig.minRetrievalScore)) {
    return emptyResult({
      investigationId: params.investigationId,
      imageId: params.vaultImageId,
      vaultMatchId: params.vaultMatchId,
      authenticationStatus: 'NO_VAULT_MATCH',
      narrative: buildNarrative({
        originalPct: 0,
        modifiedPct: 0,
        unknownPct: 0,
        available: false,
        authStatus: 'NO_VAULT_MATCH',
      }),
    });
  }

  const probe = await decodeImageForSpatialAuth(params.probeBuffer);
  const vault = await decodeImageForSpatialAuth(params.vaultBuffer);
  const blockSize = blockDnaConfig.blockSize;

  const stored = await loadStoredBlockDnaManifest(params.vaultImageId);
  let vaultTags = stored?.tagsB64
    ? vaultTagsFromStored(stored.tagsB64, stored.tagBytes)
    : vaultTagsFromRgb({
      rgb: vault.rgb,
      width: vault.width,
      height: vault.height,
      imageId: params.vaultImageId,
      blockSize,
    });

  const expectedCount = Math.ceil(vault.width / blockSize) * Math.ceil(vault.height / blockSize);
  if (vaultTags.length !== expectedCount) {
    vaultTags = vaultTagsFromRgb({
      rgb: vault.rgb,
      width: vault.width,
      height: vault.height,
      imageId: params.vaultImageId,
      blockSize,
    });
  }

  let alignment: Alignment;
  if (probe.width === vault.width && probe.height === vault.height) {
    alignment = identityAlignment();
  } else {
    const frag = params.fragmentFindings?.[0];
    const mapped = frag
      ? fragmentScaleAlignment({
        probeW: probe.width,
        probeH: probe.height,
        vaultW: vault.width,
        vaultH: vault.height,
        blockSize,
        probeRegion: frag.probeRegion,
        vaultRegion: frag.vaultRegion,
      })
      : null;
    if (mapped) {
      alignment = mapped;
    } else if (probe.width <= vault.width && probe.height <= vault.height) {
      const loc = locateTopLeftOffset({
        probeRgb: probe.rgb,
        probeW: probe.width,
        probeH: probe.height,
        vaultRgb: vault.rgb,
        vaultW: vault.width,
        vaultH: vault.height,
      });
      alignment = loc ? offsetAlignment(loc.ox, loc.oy) : { mode: 'none' };
    } else {
      alignment = { mode: 'none' };
    }
  }

  const compared = compareAlignedBlocks({
    probeRgb: probe.rgb,
    probeW: probe.width,
    probeH: probe.height,
    vaultRgb: vault.rgb,
    vaultW: vault.width,
    vaultH: vault.height,
    imageId: params.vaultImageId,
    vaultTags,
    blockSize,
    alignment,
  });

  const summary = summarizeCells(compared.cells);
  const authStatus = alignment.mode === 'none'
    ? 'GEOMETRY_UNKNOWN'
    : summary.matchedBlocks === compared.cells.length
      ? 'AUTHENTICATED'
      : summary.matchedBlocks > 0
        ? 'PARTIAL'
        : 'FAILED';

  const packed = packHover(compared.cells, compared.rows, compared.cols, compared.labels);
  const narrative = buildNarrative({
    originalPct: summary.originalBlockPercent,
    modifiedPct: summary.modifiedBlockPercent,
    unknownPct: summary.unknownBlockPercent,
    available: true,
    authStatus,
  });

  return {
    available: true,
    imageId: params.vaultImageId,
    vaultMatchId: params.vaultMatchId,
    investigationId: params.investigationId,
    overallMatch: summary.overallMatch,
    originalBlockPercent: summary.originalBlockPercent,
    modifiedBlockPercent: summary.modifiedBlockPercent,
    unknownBlockPercent: summary.unknownBlockPercent,
    totalBlocks: compared.cells.length,
    matchedBlocks: summary.matchedBlocks,
    modifiedBlocks: summary.modifiedBlocks,
    unknownBlocks: summary.unknownBlocks,
    algorithm: blockDnaConfig.algorithm,
    blockSize,
    authenticationStatus: authStatus,
    narrative,
    probeWidth: probe.width,
    probeHeight: probe.height,
    vaultWidth: vault.width,
    vaultHeight: vault.height,
    blockGrid: { rows: compared.rows, cols: compared.cols, labels: compared.labels },
    packed,
    blocks: compared.cells.length <= SMALL_GRID_CELLS ? compared.cells : undefined,
  };
}
