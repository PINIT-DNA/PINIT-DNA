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

/**
 * Describes an already-decoded RGB buffer, so a patch can be a memory slice instead
 * of another decode of the encoded image. Used by video frame DNA, where the frame
 * arrives decoded from ffmpeg and a grid means thousands of patches.
 */
export interface RawImageMeta {
  width: number;
  height: number;
  channels: 3;
}

/** One place that decides whether bytes are an encoded image or a raw RGB buffer. */
function img(buffer: Buffer, raw?: RawImageMeta) {
  return raw ? sharp(buffer, { raw }) : sharp(buffer);
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

interface PatchRect { left: number; top: number; width: number; height: number; gx: number; gy: number }

/** Formats whose patches are re-encoded in the source format by the per-patch path. */
const EXTRACTABLE_FORMATS = new Set(['jpeg', 'png', 'webp']);

/**
 * Cut patches out of one decode of the image instead of decoding the whole file again
 * for every patch (a 1 MP photo has ~1,900 patches across the scales).
 *
 * The result is byte-identical to `sharp(buffer).extract(...).toBuffer()`: the same
 * decoded pixels are cropped and re-encoded in the source format with the same
 * defaults. That matters because stored vault fingerprints were built from those
 * re-encoded patches, so a shortcut that changed the pixels would shift the hashes.
 * Anything unusual (other formats, animation, non-8-bit, colour spaces the
 * equivalence was not checked for) returns null and callers use the per-patch path.
 */
export async function createPatchExtractor(
  buffer: Buffer,
): Promise<((left: number, top: number, width: number, height: number) => Promise<Buffer>) | null> {
  try {
    const meta = await sharp(buffer).metadata();
    const format = meta.format;
    if (!format || !EXTRACTABLE_FORMATS.has(format)) return null;
    if ((meta.pages ?? 1) > 1 || meta.depth !== 'uchar') return null;
    if (meta.space !== 'srgb' && meta.space !== 'b-w') return null;
    const { data, info } = await sharp(buffer).raw().toBuffer({ resolveWithObject: true });
    const { width: fullW, channels } = info;
    if (channels !== 1 && channels !== 3 && channels !== 4) return null;
    return async (left, top, width, height) => {
      const crop = Buffer.allocUnsafe(width * height * channels);
      const rowBytes = width * channels;
      for (let y = 0; y < height; y++) {
        const src = ((top + y) * fullW + left) * channels;
        data.copy(crop, y * rowBytes, src, src + rowBytes);
      }
      return sharp(crop, { raw: { width, height, channels } })
        .toFormat(format as 'jpeg' | 'png' | 'webp')
        .toBuffer();
    };
  } catch {
    return null;
  }
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

    if (localDnaConfig.useOverlappingTiles) {
      const pyramidSizes = localDnaConfig.pyramidTileSizes.length
        ? localDnaConfig.pyramidTileSizes
        : [localDnaConfig.overlapTileSize];
      for (const tileSize of pyramidSizes) {
        const overlapGrid = await this.generateOverlappingTileGrid(
          buffer,
          tileSize,
          localDnaConfig.overlapRatio,
          patchIndex,
        );
        imageWidth = overlapGrid.imageWidth || imageWidth;
        imageHeight = overlapGrid.imageHeight || imageHeight;
        if (!globalPHash && overlapGrid.globalPHash) globalPHash = overlapGrid.globalPHash;
        for (const p of overlapGrid.patches) {
          allPatches.push({ ...p, patchIndex: patchIndex++ });
        }
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

  /**
   * Overlapping tile grid (256×256, 50% stride) — enterprise crop recovery.
   * When only 20–30% of the original image remains, overlapping tiles still match.
   */
  async generateOverlappingTileGrid(
    buffer: Buffer,
    tileSize = localDnaConfig.overlapTileSize,
    overlapRatio = localDnaConfig.overlapRatio,
    startIndex = 0,
  ): Promise<PatchGridResult> {
    const meta = await sharp(buffer).metadata();
    const imageWidth = meta.width ?? 0;
    const imageHeight = meta.height ?? 0;

    if (imageWidth < 8 || imageHeight < 8) {
      const single = await this.fingerprintPatch(buffer, startIndex, 0, 0, tileSize);
      return {
        imageWidth,
        imageHeight,
        patchSize: tileSize,
        gridCols: 1,
        gridRows: 1,
        patches: [single],
        globalPHash: single.pHash16,
        scales: [tileSize],
      };
    }

    const extractPatch = await createPatchExtractor(buffer);
    const stride = Math.max(8, Math.round(tileSize * (1 - overlapRatio)));
    const patches: PatchFingerprint[] = [];

    const rects: PatchRect[] = [];
    for (let top = 0; top < imageHeight; top += stride) {
      for (let left = 0; left < imageWidth; left += stride) {
        const width = Math.min(tileSize, imageWidth - left);
        const height = Math.min(tileSize, imageHeight - top);
        if (width < 32 || height < 32) continue;
        rects.push({ left, top, width, height, gx: Math.round(left / stride), gy: Math.round(top / stride) });
      }
    }
    patches.push(...await this.fingerprintRects(buffer, extractPatch, rects, tileSize, startIndex, localDnaConfig.maxOverlapTiles, 'overlap tile'));

    const globalPHash = patches.length
      ? patches[Math.floor(patches.length / 2)]!.pHash16
      : await this.computePHash16(await sharp(buffer).resize(32, 32, { fit: 'inside' }).toBuffer());

    const gridCols = Math.ceil(imageWidth / stride);
    const gridRows = Math.ceil(imageHeight / stride);

    return {
      imageWidth,
      imageHeight,
      patchSize: tileSize,
      gridCols,
      gridRows,
      patches,
      globalPHash,
      scales: [tileSize],
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

    const extractPatch = await createPatchExtractor(buffer);
    const gridCols = Math.ceil(imageWidth / patchSize);
    const gridRows = Math.ceil(imageHeight / patchSize);
    const maxPatches = Math.floor(localDnaConfig.maxPatchesPerImage / localDnaConfig.patchScales.length);
    const patches: PatchFingerprint[] = [];

    const rects: PatchRect[] = [];
    for (let gy = 0; gy < gridRows; gy++) {
      for (let gx = 0; gx < gridCols; gx++) {
        const left = gx * patchSize;
        const top = gy * patchSize;
        const width = Math.min(patchSize, imageWidth - left);
        const height = Math.min(patchSize, imageHeight - top);
        if (width < 4 || height < 4) continue;
        rects.push({ left, top, width, height, gx, gy });
      }
    }
    patches.push(...await this.fingerprintRects(buffer, extractPatch, rects, patchSize, startIndex, maxPatches, 'patch'));

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

  /**
   * Fingerprint rectangles in order, a few at a time. Order, indices and the cap on how many
   * patches are kept are exactly those of a one-by-one loop; a patch that fails is skipped
   * and takes no index. Running a chunk concurrently only overlaps the image work.
   */
  private async fingerprintRects(
    buffer: Buffer,
    extractPatch: Awaited<ReturnType<typeof createPatchExtractor>>,
    rects: PatchRect[],
    scale: number,
    startIndex: number,
    cap: number,
    what: string,
  ): Promise<PatchFingerprint[]> {
    const out: PatchFingerprint[] = [];
    let patchIndex = startIndex;
    const CHUNK = 16;
    for (let i = 0; i < rects.length && out.length < cap; i += CHUNK) {
      const chunk = rects.slice(i, i + CHUNK);
      const results = await Promise.all(chunk.map(async (r) => {
        try {
          const patchBuf = extractPatch
            ? await extractPatch(r.left, r.top, r.width, r.height)
            : await sharp(buffer).extract({ left: r.left, top: r.top, width: r.width, height: r.height }).toBuffer();
          return await this.fingerprintPatch(patchBuf, 0, r.gx, r.gy, scale);
        } catch (err) {
          logger.debug(`[LocalDnaPatch] Skip ${what}`, { gx: r.gx, gy: r.gy, scale, error: String(err) });
          return null;
        }
      }));
      for (const fp of results) {
        if (!fp) continue;
        if (out.length >= cap) break;
        out.push({ ...fp, patchIndex: patchIndex++ });
      }
    }
    return out;
  }

  private async fingerprintPatch(
    patchBuffer: Buffer,
    patchIndex: number,
    gridX: number,
    gridY: number,
    scale: number,
    raw?: RawImageMeta,
  ): Promise<PatchFingerprint> {
    // Each feature below used to decode the encoded patch on its own (7 decodes). For PNG
    // patches (lossless, no decode-time shrinking) decoding once and sharing the pixels gives
    // identical values for a seventh of the work. JPEG/WebP are deliberately excluded: their
    // decoders shrink while loading when a feature resizes down, so pixels from a full decode
    // differ slightly and could flip hash bits. Those keep the per-feature decode.
    if (!raw && patchBuffer.length > 8 && patchBuffer[0] === 0x89 && patchBuffer[1] === 0x50) {
      try {
        const { data, info } = await sharp(patchBuffer).raw().toBuffer({ resolveWithObject: true });
        if (info.channels === 3) {
          patchBuffer = data;
          raw = { width: info.width, height: info.height, channels: 3 };
        }
      } catch { /* fall through to the per-feature decode */ }
    }
    const [pHash16, dHash8, aHash8, edgeSignature, colorVector, frequencySig, textureSig] = await Promise.all([
      this.computePHash16(patchBuffer, raw),
      this.computeDHash8(patchBuffer, raw),
      this.computeAHash8(patchBuffer, raw),
      this.computeEdgeSignature(patchBuffer, raw),
      this.computeColorVector(patchBuffer, raw),
      this.computeFrequencySig(patchBuffer, raw),
      this.computeTextureSig(patchBuffer, raw),
    ]);
    return {
      patchIndex, gridX, gridY, scale, pHash16, dHash8, aHash8,
      edgeSignature, colorVector, frequencySig, textureSig,
    };
  }

  async computePHash16(patchBuffer: Buffer, raw?: RawImageMeta): Promise<string> {
    const { data } = await img(patchBuffer, raw)
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

  async computeDHash8(patchBuffer: Buffer, raw?: RawImageMeta): Promise<string> {
    const { data, info } = await img(patchBuffer, raw)
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

  private async computeAHash8(patchBuffer: Buffer, raw?: RawImageMeta): Promise<string> {
    const { data } = await img(patchBuffer, raw)
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

  private async computeEdgeSignature(patchBuffer: Buffer, raw?: RawImageMeta): Promise<string> {
    const { data, info } = await img(patchBuffer, raw)
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

  private async computeColorVector(patchBuffer: Buffer, raw?: RawImageMeta): Promise<[number, number, number]> {
    const { data } = await img(patchBuffer, raw)
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

  private async computeFrequencySig(patchBuffer: Buffer, raw?: RawImageMeta): Promise<string> {
    const { data } = await img(patchBuffer, raw)
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

  private async computeTextureSig(patchBuffer: Buffer, raw?: RawImageMeta): Promise<string> {
    const { data, info } = await img(patchBuffer, raw)
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
