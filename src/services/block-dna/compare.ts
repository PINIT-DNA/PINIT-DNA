import { BLOCK_DNA_VERSION } from '../../config/block-dna';
import type { BlockDnaCellResult, BlockDnaClassification, BlockDnaPackedHover } from '../../types/block-dna.types';
import { computeBlockDnaHmac, hmacEquals, truncateDnaHex } from './hmac';
import { enumerateBlocks, extractCellRgb, gridShape } from './grid';
import { generateBlockDnaTags, unpackTags } from './manifest';
import {
  applyJpegUnknownPolicy,
  blockConfidence,
  classifyBlock,
} from './classify';
import {
  contentKey,
  firstDifferingPixel,
  meanAbsDiff,
  pixelSimilarity,
  structuralSimilarity,
} from './similarity';

export interface Alignment {
  mode: 'identity' | 'offset' | 'mapped' | 'none';
  /** Probe (x,y) → vault pixel origin for that block. */
  vaultOriginForProbeBlock?: (probeX: number, probeY: number) => { vx: number; vy: number } | null;
}

export function identityAlignment(): Alignment {
  return {
    mode: 'identity',
    vaultOriginForProbeBlock: (x, y) => ({ vx: x, vy: y }),
  };
}

export function offsetAlignment(ox: number, oy: number): Alignment {
  return {
    mode: 'offset',
    vaultOriginForProbeBlock: (x, y) => ({ vx: x + ox, vy: y + oy }),
  };
}

function pct(n: number, d: number): number {
  if (d <= 0) return 0;
  return Math.round((n / d) * 1000) / 10;
}

function snapToBlock(v: number, blockSize: number): number {
  return Math.round(v / blockSize) * blockSize;
}

export function fragmentScaleAlignment(params: {
  probeW: number;
  probeH: number;
  vaultW: number;
  vaultH: number;
  blockSize: number;
  probeRegion: { xPercent: number; yPercent: number; widthPercent: number; heightPercent: number };
  vaultRegion: { xPercent: number; yPercent: number; widthPercent: number; heightPercent: number };
}): Alignment | null {
  const pW = (params.probeRegion.widthPercent / 100) * params.probeW;
  const pH = (params.probeRegion.heightPercent / 100) * params.probeH;
  const vW = (params.vaultRegion.widthPercent / 100) * params.vaultW;
  const vH = (params.vaultRegion.heightPercent / 100) * params.vaultH;
  if (pW < 4 || pH < 4 || vW < 4 || vH < 4) return null;
  const sx = vW / pW;
  const sy = vH / pH;
  if (Math.abs(sx - 1) > 0.08 || Math.abs(sy - 1) > 0.08) return null;
  const p0x = (params.probeRegion.xPercent / 100) * params.probeW;
  const p0y = (params.probeRegion.yPercent / 100) * params.probeH;
  const v0x = (params.vaultRegion.xPercent / 100) * params.vaultW;
  const v0y = (params.vaultRegion.yPercent / 100) * params.vaultH;
  const ox = snapToBlock(v0x - p0x, params.blockSize);
  const oy = snapToBlock(v0y - p0y, params.blockSize);
  return offsetAlignment(ox, oy);
}

export function locateTopLeftOffset(params: {
  probeRgb: Buffer;
  probeW: number;
  probeH: number;
  vaultRgb: Buffer;
  vaultW: number;
  vaultH: number;
  maxMad?: number;
}): { ox: number; oy: number } | null {
  const tw = Math.min(16, params.probeW);
  const th = Math.min(16, params.probeH);
  if (params.probeW > params.vaultW || params.probeH > params.vaultH) return null;
  const template = Buffer.alloc(tw * th * 3);
  for (let row = 0; row < th; row++) {
    params.probeRgb.copy(
      template,
      row * tw * 3,
      row * params.probeW * 3,
      row * params.probeW * 3 + tw * 3,
    );
  }
  const maxMad = params.maxMad ?? 1.5;
  let best: { ox: number; oy: number; mad: number } | null = null;
  const area = params.vaultW * params.vaultH;
  const step = area > 80_000 ? 8 : 1;
  for (let oy = 0; oy <= params.vaultH - th; oy += step) {
    for (let ox = 0; ox <= params.vaultW - tw; ox += step) {
      let s = 0;
      for (let row = 0; row < th; row++) {
        const src = ((oy + row) * params.vaultW + ox) * 3;
        const dst = row * tw * 3;
        for (let i = 0; i < tw * 3; i++) {
          s += Math.abs(params.vaultRgb[src + i]! - template[dst + i]!);
        }
      }
      const mad = s / (tw * th * 3);
      if (!best || mad < best.mad) best = { ox, oy, mad };
      if (mad < 0.01) return { ox, oy };
    }
  }
  if (best && best.mad <= maxMad) return { ox: best.ox, oy: best.oy };
  return null;
}

export function compareAlignedBlocks(params: {
  probeRgb: Buffer;
  probeW: number;
  probeH: number;
  vaultRgb: Buffer;
  vaultW: number;
  vaultH: number;
  imageId: string;
  vaultTags: Buffer[];
  blockSize: number;
  alignment: Alignment;
}): {
  cells: BlockDnaCellResult[];
  labels: string;
  rows: number;
  cols: number;
} {
  const blockSize = params.blockSize;
  const probeGeoms = enumerateBlocks(params.probeW, params.probeH, blockSize);
  const { cols, rows } = gridShape(params.probeW, params.probeH, blockSize);
  const vaultGeoms = enumerateBlocks(params.vaultW, params.vaultH, blockSize);
  const vaultIndex = new Map<string, number>();
  for (let i = 0; i < vaultGeoms.length; i++) {
    const g = vaultGeoms[i]!;
    vaultIndex.set(`${g.x},${g.y}`, i);
  }

  const vaultByContent = new Map<string, number[]>();
  for (let i = 0; i < vaultGeoms.length; i++) {
    const g = vaultGeoms[i]!;
    const rgb = extractCellRgb(params.vaultRgb, params.vaultW, params.vaultH, g);
    const k = contentKey(rgb);
    const list = vaultByContent.get(k) ?? [];
    list.push(i);
    vaultByContent.set(k, list);
  }

  const dnaMatches: boolean[] = [];
  const mads: number[] = [];
  const rawStatus: BlockDnaClassification[] = [];
  const cells: BlockDnaCellResult[] = [];

  const mapFn = params.alignment.vaultOriginForProbeBlock;
  const geometryUnsupported = params.alignment.mode === 'none' || !mapFn;

  for (const g of probeGeoms) {
    const probeRgb = extractCellRgb(params.probeRgb, params.probeW, params.probeH, g);
    let corresponding = false;
    let vaultTag: Buffer = Buffer.alloc(32);
    let vaultRgb: Buffer = Buffer.alloc(0);
    let vx = g.x;
    let vy = g.y;

    if (!geometryUnsupported && mapFn) {
      const origin = mapFn(g.x, g.y);
      if (origin) {
        vx = origin.vx;
        vy = origin.vy;
        const idx = vaultIndex.get(`${vx},${vy}`);
        if (idx != null) {
          corresponding = true;
          vaultTag = Buffer.from(params.vaultTags[idx] ?? Buffer.alloc(32));
          vaultRgb = Buffer.from(extractCellRgb(params.vaultRgb, params.vaultW, params.vaultH, vaultGeoms[idx]!));
        }
      }
    }

    const calcTag = computeBlockDnaHmac({
      imageId: params.imageId,
      imageWidth: params.vaultW,
      imageHeight: params.vaultH,
      blockX: corresponding ? vx : g.x,
      blockY: corresponding ? vy : g.y,
      blockWidth: g.width,
      blockHeight: g.height,
      blockSize,
      version: BLOCK_DNA_VERSION,
      blockRgb: probeRgb,
    });

    const dnaMatch = corresponding && hmacEquals(calcTag, vaultTag);
    const mad = corresponding ? meanAbsDiff(probeRgb, vaultRgb) : 255;
    const pix = corresponding ? pixelSimilarity(probeRgb, vaultRgb) : 0;
    const struct = corresponding && vaultRgb.length === probeRgb.length
      ? structuralSimilarity(probeRgb, vaultRgb)
      : 0;

    let relocated = false;
    if (!dnaMatch && corresponding) {
      const hits = vaultByContent.get(contentKey(probeRgb));
      if (hits && hits.some((i) => {
        const vg = vaultGeoms[i]!;
        return vg.x !== vx || vg.y !== vy;
      })) {
        relocated = true;
      }
    }

    const status = classifyBlock({
      dnaMatch,
      pixelSimilarity: pix,
      meanAbsDiff: mad,
      relocated,
      correspondingRegion: corresponding,
      geometryUnsupported,
    });

    dnaMatches.push(dnaMatch);
    mads.push(mad);
    rawStatus.push(status);

    const hint = corresponding && !dnaMatch && vaultRgb.length === probeRgb.length
      ? firstDifferingPixel(probeRgb, vaultRgb, g.width, g.height, g.x, g.y)
      : undefined;

    cells.push({
      x: g.x,
      y: g.y,
      width: g.width,
      height: g.height,
      status,
      confidence: blockConfidence(dnaMatch, pix, struct),
      dnaVerified: dnaMatch,
      pixelSimilarity: pix,
      structuralSimilarity: struct,
      vaultDna: truncateDnaHex(vaultTag),
      calculatedDna: truncateDnaHex(calcTag),
      pixelHint: hint,
    });
  }

  const finalStatus = geometryUnsupported
    ? rawStatus
    : applyJpegUnknownPolicy(rawStatus, mads, dnaMatches);

  let labels = '';
  for (let i = 0; i < cells.length; i++) {
    const s = finalStatus[i]!;
    cells[i]!.status = s;
    labels += s === 'ORIGINAL' ? 'G' : s === 'MODIFIED' ? 'A' : 'U';
  }

  return { cells, labels, rows, cols };
}

export function packHover(cells: BlockDnaCellResult[], rows: number, cols: number, labels: string): BlockDnaPackedHover {
  let vaultDnaHex16 = '';
  let calcDnaHex16 = '';
  let pixelSimPct = '';
  let structSimPct = '';
  let dnaOk = '';
  for (const c of cells) {
    vaultDnaHex16 += (c.vaultDna + '0'.repeat(16)).slice(0, 16);
    calcDnaHex16 += (c.calculatedDna + '0'.repeat(16)).slice(0, 16);
    pixelSimPct += String.fromCharCode(Math.round(c.pixelSimilarity * 100));
    structSimPct += String.fromCharCode(Math.round(c.structuralSimilarity * 100));
    dnaOk += c.dnaVerified ? '1' : '0';
  }
  return { rows, cols, labels, vaultDnaHex16, calcDnaHex16, pixelSimPct, structSimPct, dnaOk };
}

export function summarizeCells(cells: BlockDnaCellResult[]): {
  matchedBlocks: number;
  modifiedBlocks: number;
  unknownBlocks: number;
  originalBlockPercent: number;
  modifiedBlockPercent: number;
  unknownBlockPercent: number;
  overallMatch: number;
} {
  let matched = 0;
  let modified = 0;
  let unknown = 0;
  for (const c of cells) {
    if (c.status === 'ORIGINAL') matched += 1;
    else if (c.status === 'MODIFIED') modified += 1;
    else unknown += 1;
  }
  const n = cells.length;
  return {
    matchedBlocks: matched,
    modifiedBlocks: modified,
    unknownBlocks: unknown,
    originalBlockPercent: pct(matched, n),
    modifiedBlockPercent: pct(modified, n),
    unknownBlockPercent: pct(unknown, n),
    overallMatch: n ? matched / n : 0,
  };
}

export function vaultTagsFromRgb(params: {
  rgb: Buffer;
  width: number;
  height: number;
  imageId: string;
  blockSize: number;
}): Buffer[] {
  return generateBlockDnaTags(params).tags;
}

export function vaultTagsFromStored(tagsB64: string, tagBytes: number): Buffer[] {
  return unpackTags(Buffer.from(tagsB64, 'base64'), tagBytes);
}
