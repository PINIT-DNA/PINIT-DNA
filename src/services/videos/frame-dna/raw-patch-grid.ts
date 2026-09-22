/**
 * The multi-scale patch grid for one decoded video frame.
 *
 * Same grid the encoded-image path builds — same scales from localDnaConfig, same
 * overlapping pyramid tiles, same caps, same patch ordering — so the packed result is
 * a drop-in for the LocalDnaPatch rows it replaces. The difference is that every
 * patch is fingerprinted straight from the frame's pixels (see fast-patch-fingerprint),
 * instead of running seven image pipelines per patch.
 */
import { localDnaConfig } from '../../../config/local-dna';
import type { PatchFingerprint, PatchGridResult } from '../../forensics/local-dna-patch-generator.service';
import { fingerprintRawPatchFast } from './fast-patch-fingerprint';

export function buildRawPatchGrid(
  rgb: Buffer,
  imageWidth: number,
  imageHeight: number,
  scalesOverride?: number[],
): PatchGridResult {
  const scales = scalesOverride?.length ? scalesOverride : localDnaConfig.patchScales;
  const patches: PatchFingerprint[] = [];
  let patchIndex = 0;
  let globalPHash = '';

  const maxPerScale = Math.floor(localDnaConfig.maxPatchesPerImage / localDnaConfig.patchScales.length);

  for (const scale of scales) {
    const cols = Math.ceil(imageWidth / scale);
    const rows = Math.ceil(imageHeight / scale);
    const before = patches.length;

    for (let gy = 0; gy < rows; gy++) {
      if (patches.length - before >= maxPerScale) break;
      for (let gx = 0; gx < cols; gx++) {
        if (patches.length - before >= maxPerScale) break;
        const left = gx * scale;
        const top = gy * scale;
        const width = Math.min(scale, imageWidth - left);
        const height = Math.min(scale, imageHeight - top);
        if (width < 4 || height < 4) continue;

        patches.push(fingerprintRawPatchFast({
          rgb, frameWidth: imageWidth, left, top, width, height,
          patchIndex: patchIndex++, gridX: gx, gridY: gy, scale,
        }));
      }
    }

    if (!globalPHash && patches.length > before) {
      globalPHash = patches[before + Math.floor((patches.length - before) / 2)]!.pHash16;
    }
  }

  if (localDnaConfig.useOverlappingTiles) {
    const tileSizes = localDnaConfig.pyramidTileSizes.length
      ? localDnaConfig.pyramidTileSizes
      : [localDnaConfig.overlapTileSize];

    for (const tileSize of tileSizes) {
      const stride = Math.max(8, Math.round(tileSize * (1 - localDnaConfig.overlapRatio)));
      let tilesForSize = 0;

      for (let top = 0; top < imageHeight; top += stride) {
        if (tilesForSize >= localDnaConfig.maxOverlapTiles) break;
        for (let left = 0; left < imageWidth; left += stride) {
          if (tilesForSize >= localDnaConfig.maxOverlapTiles) break;
          const width = Math.min(tileSize, imageWidth - left);
          const height = Math.min(tileSize, imageHeight - top);
          if (width < 32 || height < 32) continue;

          patches.push(fingerprintRawPatchFast({
            rgb, frameWidth: imageWidth, left, top, width, height,
            patchIndex: patchIndex++,
            gridX: Math.round(left / stride),
            gridY: Math.round(top / stride),
            scale: tileSize,
          }));
          tilesForSize += 1;
        }
      }
    }
  }

  const primary = scales.includes(32) ? 32 : scales[0] ?? 32;
  return {
    imageWidth,
    imageHeight,
    patchSize: primary,
    gridCols: imageWidth > 0 ? Math.ceil(imageWidth / primary) : 1,
    gridRows: imageHeight > 0 ? Math.ceil(imageHeight / primary) : 1,
    patches,
    globalPHash: globalPHash || (patches[0]?.pHash16 ?? ''),
    scales,
  };
}
