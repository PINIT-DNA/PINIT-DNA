/**
 * Generates patch-level local DNA fingerprints from image buffers.
 * Supports multi-scale grids (16/32/64/128) with dense per-patch features.
 */
import sharp from 'sharp';
import { localDnaConfig } from '../../config/local-dna';
import { logger } from '../../lib/logger';

export interface PatchFingerprint {
  patchIndex: number;
  gridX: number;
  gridY: number;
  scale: number;
  pHash16: string;
  dHash8: string;
  aHash8: string;
  edgeSignature: string;
  colorVector: [number, number, number];
  frequencySig: string;
  textureSig: string;
}

export interface PatchGridResult {
  imageWidth: number;
  imageHeight: number;
  patchSize: number;
  gridCols: number;
  gridRows: number;
  patches: PatchFingerprint[];
  globalPHash: string;
  scales: number[];
}

function hammingBits(a: string, b: string): number {
  if (!a || !b || a.length !== b.length) return 64;
  let dist = 0;
  for (let i = 0; i < a.length; i++) {
    const x = parseInt(a[i]!, 16) ^ parseInt(b[i]!, 16);
    dist += (x & 1) + ((x >> 1) & 1) + ((x >> 2) & 1) + ((x >> 3) & 1);
  }
  return dist;
}

export function patchFingerprintsMatch(a: string, b: string, maxDist?: number): boolean {
  const threshold = maxDist ?? localDnaConfig.patchHammingThreshold;
  return hammingBits(a, b) <= threshold;
}

function colorDistance(a: [number, number, number], b: [number, number, number]): number {
  return Math.sqrt(
    (a[0] - b[0]) ** 2 + (a[1] - b[1]) ** 2 + (a[2] - b[2]) ** 2,
  );
}

/** Secondary match when pHash is close but not exact — edge + color agreement */
export function patchDenseMatch(
  probe: Pick<PatchFingerprint, 'pHash16' | 'dHash8' | 'aHash8' | 'edgeSignature' | 'colorVector' | 'frequencySig' | 'textureSig'>,
  vault: Pick<PatchFingerprint, 'pHash16' | 'dHash8' | 'aHash8' | 'edgeSignature' | 'colorVector' | 'frequencySig' | 'textureSig'>,
): boolean {
  if (patchFingerprintsMatch(probe.pHash16, vault.pHash16)) return true;
  if (hammingBits(probe.pHash16, vault.pHash16) > localDnaConfig.patchHammingThreshold + 4) return false;

  let votes = 0;
  if (probe.dHash8 && vault.dHash8 && hammingBits(probe.dHash8, vault.dHash8) <= 6) votes++;
  if (probe.aHash8 && vault.aHash8 && hammingBits(probe.aHash8, vault.aHash8) <= 6) votes++;
  if (probe.edgeSignature === vault.edgeSignature) votes++;
  if (colorDistance(probe.colorVector, vault.colorVector) < 45) votes++;
  if (probe.frequencySig === vault.frequencySig) votes++;
  if (probe.textureSig === vault.textureSig) votes++;
  return votes >= 3;
}

export class LocalDnaPatchGenerator {
  /** Single-scale grid (legacy) */
  async generateGrid(buffer: Buffer, patchSize = localDnaConfig.patchSize): Promise<PatchGridResult> {
    const grid = await this.generateScaleGrid(buffer, patchSize);
    return { ...grid, scales: [patchSize] };
  }

  /** Multi-scale enterprise retrieval grid — optional scale override for investigation fast path */
  async generateMultiScaleGrid(buffer: Buffer, scalesOverride?: number[]): Promise<PatchGridResult> {
    const scales = scalesOverride?.length ? scalesOverride : localDnaConfig.patchScales;
    const allPatches: PatchFingerprint[] = [];
    let imageWidth = 0;
    let imageHeight = 0;
    let globalPHash = '';
    let patchIndex = 0;

    for (const scale of scales) {
      const grid = await this.generateScaleGrid(buffer, scale, patchIndex);
      imageWidth = grid.imageWidth;
      imageHeight = grid.imageHeight;
      if (!globalPHash && grid.globalPHash) globalPHash = grid.globalPHash;
      for (const p of grid.patches) {
        allPatches.push({ ...p, patchIndex: patchIndex++ });
      }
    }

    const primary = scales.includes(32) ? 32 : scales[0] ?? 32;
    const gridCols = imageWidth > 0 ? Math.ceil(imageWidth / primary) : 1;
    const gridRows = imageHeight > 0 ? Math.ceil(imageHeight / primary) : 1;

    return {
      imageWidth,
      imageHeight,
      patchSize: primary,
      gridCols,
      gridRows,
      patches: allPatches,
      globalPHash: globalPHash || (allPatches[0]?.pHash16 ?? ''),
      scales,
    };
  }

  private async generateScaleGrid(
    buffer: Buffer,
    patchSize: number,
    startIndex = 0,
  ): Promise<PatchGridResult> {
    const meta = await sharp(buffer).metadata();
    const imageWidth = meta.width ?? 0;
    const imageHeight = meta.height ?? 0;

    if (imageWidth < 8 || imageHeight < 8) {
      const single = await this.fingerprintPatch(buffer, startIndex, 0, 0, patchSize);
      return {
        imageWidth,
        imageHeight,
        patchSize,
        gridCols: 1,
        gridRows: 1,
        patches: [single],
        globalPHash: single.pHash16,
        scales: [patchSize],
      };
    }

    const gridCols = Math.ceil(imageWidth / patchSize);
    const gridRows = Math.ceil(imageHeight / patchSize);
    const maxPatches = Math.floor(localDnaConfig.maxPatchesPerImage / localDnaConfig.patchScales.length);
    const patches: PatchFingerprint[] = [];
    let patchIndex = startIndex;

    for (let gy = 0; gy < gridRows; gy++) {
      for (let gx = 0; gx < gridCols; gx++) {
        if (patches.length >= maxPatches) break;

        const left = gx * patchSize;
        const top = gy * patchSize;
        const width = Math.min(patchSize, imageWidth - left);
        const height = Math.min(patchSize, imageHeight - top);
        if (width < 4 || height < 4) continue;

        try {
          const patchBuf = await sharp(buffer)
            .extract({ left, top, width, height })
            .toBuffer();
          patches.push(await this.fingerprintPatch(patchBuf, patchIndex, gx, gy, patchSize));
          patchIndex++;
        } catch (err) {
          logger.debug('[LocalDnaPatch] Skip patch', { gx, gy, scale: patchSize, error: String(err) });
        }
      }
      if (patches.length >= maxPatches) break;
    }

    const globalPHash = patches.length
      ? patches[Math.floor(patches.length / 2)]!.pHash16
      : await this.computePHash16(await sharp(buffer).resize(32, 32, { fit: 'inside' }).toBuffer());

    return {
      imageWidth,
      imageHeight,
      patchSize,
      gridCols,
      gridRows,
      patches,
      globalPHash,
      scales: [patchSize],
    };
  }

  private async fingerprintPatch(
    patchBuffer: Buffer,
    patchIndex: number,
    gridX: number,
    gridY: number,
    scale: number,
  ): Promise<PatchFingerprint> {
    const [pHash16, dHash8, aHash8, edgeSignature, colorVector, frequencySig, textureSig] = await Promise.all([
      this.computePHash16(patchBuffer),
      this.computeDHash8(patchBuffer),
      this.computeAHash8(patchBuffer),
      this.computeEdgeSignature(patchBuffer),
      this.computeColorVector(patchBuffer),
      this.computeFrequencySig(patchBuffer),
      this.computeTextureSig(patchBuffer),
    ]);
    return {
      patchIndex, gridX, gridY, scale, pHash16, dHash8, aHash8,
      edgeSignature, colorVector, frequencySig, textureSig,
    };
  }

  async computePHash16(patchBuffer: Buffer): Promise<string> {
    const { data } = await sharp(patchBuffer)
      .resize(8, 8, { fit: 'fill' })
      .greyscale()
      .raw()
      .toBuffer({ resolveWithObject: true });

    const avg = data.reduce((a, b) => a + b, 0) / Math.max(data.length, 1);
    let bits = '';
    for (const p of data) bits += p >= avg ? '1' : '0';
    let hex = '';
    for (let i = 0; i < 64; i += 4) {
      hex += parseInt(bits.slice(i, i + 4).padEnd(4, '0'), 2).toString(16);
    }
    return hex.padStart(16, '0');
  }

  private async computeDHash8(patchBuffer: Buffer): Promise<string> {
    const { data, info } = await sharp(patchBuffer)
      .resize(9, 8, { fit: 'fill' })
      .greyscale()
      .raw()
      .toBuffer({ resolveWithObject: true });
    const w = info.width;
    let bits = '';
    for (let y = 0; y < info.height; y++) {
      for (let x = 0; x < w - 1; x++) {
        const i = y * w + x;
        bits += (data[i + 1]! > data[i]!) ? '1' : '0';
      }
    }
    let hex = '';
    for (let i = 0; i < Math.min(32, bits.length); i += 4) {
      hex += parseInt(bits.slice(i, i + 4).padEnd(4, '0'), 2).toString(16);
    }
    return hex.padStart(8, '0');
  }

  private async computeAHash8(patchBuffer: Buffer): Promise<string> {
    const { data } = await sharp(patchBuffer)
      .resize(8, 8, { fit: 'fill' })
      .greyscale()
      .raw()
      .toBuffer({ resolveWithObject: true });
    const avg = data.reduce((a, b) => a + b, 0) / Math.max(data.length, 1);
    let bits = '';
    for (const p of data) bits += p >= avg ? '1' : '0';
    let hex = '';
    for (let i = 0; i < 32; i += 4) {
      hex += parseInt(bits.slice(i, i + 4).padEnd(4, '0'), 2).toString(16);
    }
    return hex.padStart(8, '0');
  }

  private async computeEdgeSignature(patchBuffer: Buffer): Promise<string> {
    const { data, info } = await sharp(patchBuffer)
      .greyscale()
      .raw()
      .toBuffer({ resolveWithObject: true });
    const w = info.width;
    let edges = 0;
    const total = Math.max((info.height - 1) * (w - 1), 1);
    for (let y = 0; y < info.height - 1; y++) {
      for (let x = 0; x < w - 1; x++) {
        const i = y * w + x;
        const gx = Math.abs(data[i + 1]! - data[i]!);
        const gy = Math.abs(data[i + w]! - data[i]!);
        if (gx + gy > 35) edges++;
      }
    }
    return Math.round((edges / total) * 255).toString(16).padStart(2, '0');
  }

  private async computeColorVector(patchBuffer: Buffer): Promise<[number, number, number]> {
    const { data } = await sharp(patchBuffer)
      .resize(4, 4, { fit: 'fill' })
      .removeAlpha()
      .raw()
      .toBuffer({ resolveWithObject: true });
    let r = 0; let g = 0; let b = 0;
    const pixels = Math.max(data.length / 3, 1);
    for (let i = 0; i < data.length; i += 3) {
      r += data[i] ?? 0;
      g += data[i + 1] ?? 0;
      b += data[i + 2] ?? 0;
    }
    return [Math.round(r / pixels), Math.round(g / pixels), Math.round(b / pixels)];
  }

  private async computeFrequencySig(patchBuffer: Buffer): Promise<string> {
    const { data } = await sharp(patchBuffer)
      .greyscale()
      .resize(16, 16, { fit: 'fill' })
      .raw()
      .toBuffer({ resolveWithObject: true });
    let variance = 0;
    const mean = data.reduce((a, v) => a + v, 0) / Math.max(data.length, 1);
    for (const v of data) variance += (v - mean) ** 2;
    variance /= Math.max(data.length, 1);
    return Math.min(255, Math.round(Math.sqrt(variance))).toString(16).padStart(2, '0');
  }

  private async computeTextureSig(patchBuffer: Buffer): Promise<string> {
    const { data, info } = await sharp(patchBuffer)
      .greyscale()
      .resize(8, 8, { fit: 'fill' })
      .raw()
      .toBuffer({ resolveWithObject: true });
    const w = info.width;
    let laplacian = 0;
    let count = 0;
    for (let y = 1; y < info.height - 1; y++) {
      for (let x = 1; x < w - 1; x++) {
        const i = y * w + x;
        const v = Math.abs(
          4 * data[i]! - data[i - 1]! - data[i + 1]! - data[i - w]! - data[i + w]!,
        );
        laplacian += v;
        count++;
      }
    }
    return Math.min(255, Math.round(laplacian / Math.max(count, 1))).toString(16).padStart(2, '0');
  }
}

export const localDnaPatchGenerator = new LocalDnaPatchGenerator();
