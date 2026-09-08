/**
 * Pixel-source forensic map: which uploaded pixels originate from the vault.
 * Retrieval embeddings are NOT used as coverage. HMAC is not the overlay.
 */
import sharp from 'sharp';

export const PIXEL_CLASS = {
  UNKNOWN: 0,
  VAULT: 1,
  NON_VAULT: 2,
} as const;

export interface PixelSourceRegion {
  type: 'VAULT_MATCH';
  uploadedBounds: { x: number; y: number; width: number; height: number };
  vaultBounds: { x: number; y: number; width: number; height: number };
  confidence: number;
  coveragePercent: number;
}

export interface PixelSourceAnalysis {
  width: number;
  height: number;
  vaultWidth: number;
  vaultHeight: number;
  originalPixels: number;
  aiSuspectedPixels: number;
  unknownPixels: number;
  totalPixels: number;
  protectedFromAssetPercent: number;
  aiGeneratedPercent: number;
  otherPercent: number;
  originalUsedPercent: number;
  regions: PixelSourceRegion[];
  probeRegion?: { xPercent: number; yPercent: number; widthPercent: number; heightPercent: number };
  maskPngBase64?: string;
  overlayPngBase64?: string;
  homographyVaultToProbe?: number[] | null;
  method: string;
}

function round1(n: number): number {
  return Math.round(n * 10) / 10;
}

async function decodeRgb(buf: Buffer): Promise<{ rgb: Buffer; width: number; height: number }> {
  const { data, info } = await sharp(buf).removeAlpha().raw().toBuffer({ resolveWithObject: true });
  if (info.channels !== 3) throw new Error('expected RGB');
  return { rgb: data, width: info.width, height: info.height };
}

function meanAbsPixel(a: Buffer, ai: number, b: Buffer, bi: number): number {
  return (
    Math.abs(a[ai]! - b[bi]!)
    + Math.abs(a[ai + 1]! - b[bi + 1]!)
    + Math.abs(a[ai + 2]! - b[bi + 2]!)
  ) / 3;
}

function summarize(map: Uint8Array, w: number, h: number, vw: number, vh: number): {
  originalPixels: number;
  aiSuspectedPixels: number;
  unknownPixels: number;
  totalPixels: number;
  protectedFromAssetPercent: number;
  aiGeneratedPercent: number;
  otherPercent: number;
  originalUsedPercent: number;
  probeRegion?: PixelSourceAnalysis['probeRegion'];
  regions: PixelSourceRegion[];
} {
  let g = 0;
  let a = 0;
  let u = 0;
  let minX = w;
  let minY = h;
  let maxX = 0;
  let maxY = 0;
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const v = map[y * w + x]!;
      if (v === PIXEL_CLASS.VAULT) {
        g += 1;
        if (x < minX) minX = x;
        if (y < minY) minY = y;
        if (x > maxX) maxX = x;
        if (y > maxY) maxY = y;
      } else if (v === PIXEL_CLASS.NON_VAULT) a += 1;
      else u += 1;
    }
  }
  const total = w * h;
  const regions: PixelSourceRegion[] = [];
  if (g > 0) {
    const bw = Math.max(1, maxX - minX + 1);
    const bh = Math.max(1, maxY - minY + 1);
    regions.push({
      type: 'VAULT_MATCH',
      uploadedBounds: { x: minX, y: minY, width: bw, height: bh },
      vaultBounds: { x: 0, y: 0, width: vw, height: vh },
      confidence: 0.95,
      coveragePercent: round1((g / total) * 100),
    });
  }
  return {
    originalPixels: g,
    aiSuspectedPixels: a,
    unknownPixels: u,
    totalPixels: total,
    protectedFromAssetPercent: round1((g / total) * 100),
    aiGeneratedPercent: round1((a / total) * 100),
    otherPercent: round1((u / total) * 100),
    originalUsedPercent: round1(Math.min(100, (g / Math.max(1, vw * vh)) * 100)),
    probeRegion: g > 16
      ? {
        xPercent: round1((minX / w) * 100),
        yPercent: round1((minY / h) * 100),
        widthPercent: round1(((maxX - minX + 1) / w) * 100),
        heightPercent: round1(((maxY - minY + 1) / h) * 100),
      }
      : undefined,
    regions,
  };
}

/** Same-size 1×1 compare. Used for exact original / single-pixel tests. */
export function classifyIdentityPixels(
  probeRgb: Buffer,
  vaultRgb: Buffer,
  width: number,
  height: number,
  greenMax = 12,
): Uint8Array {
  const n = width * height;
  const map = new Uint8Array(n);
  for (let i = 0; i < n; i++) {
    const d = meanAbsPixel(probeRgb, i * 3, vaultRgb, i * 3);
    map[i] = d <= greenMax ? PIXEL_CLASS.VAULT : PIXEL_CLASS.NON_VAULT;
  }
  return map;
}

/** Paste a vault crop into a canvas at (dx,dy); classify 1×1. */
export function classifyPastedCrop(params: {
  probeRgb: Buffer;
  probeW: number;
  probeH: number;
  vaultRgb: Buffer;
  vaultW: number;
  vaultH: number;
  paste: { x: number; y: number; width: number; height: number };
  vaultCrop: { x: number; y: number; width: number; height: number };
  greenMax?: number;
}): Uint8Array {
  const greenMax = params.greenMax ?? 12;
  const { probeW, probeH, vaultW } = params;
  const map = new Uint8Array(probeW * probeH);
  map.fill(PIXEL_CLASS.NON_VAULT);
  const { x: px, y: py, width: pw, height: ph } = params.paste;
  const { x: vx, y: vy } = params.vaultCrop;
  for (let row = 0; row < ph; row++) {
    for (let col = 0; col < pw; col++) {
      const ux = px + col;
      const uy = py + row;
      if (ux < 0 || uy < 0 || ux >= probeW || uy >= probeH) continue;
      const pi = (uy * probeW + ux) * 3;
      const vi = ((vy + row) * vaultW + (vx + col)) * 3;
      if (vi + 2 >= params.vaultRgb.length) continue;
      const d = meanAbsPixel(params.probeRgb, pi, params.vaultRgb, vi);
      map[uy * probeW + ux] = d <= greenMax ? PIXEL_CLASS.VAULT : PIXEL_CLASS.NON_VAULT;
    }
  }
  return map;
}

export async function buildPixelSourceAnalysis(params: {
  probeBuffer: Buffer;
  vaultBuffer: Buffer;
  paste?: {
    x: number;
    y: number;
    width: number;
    height: number;
    vaultX?: number;
    vaultY?: number;
  };
}): Promise<PixelSourceAnalysis> {
  const probe = await decodeRgb(params.probeBuffer);
  const vault = await decodeRgb(params.vaultBuffer);
  let map: Uint8Array;
  let method = 'identity_1x1';
  if (
    params.paste
    && (probe.width !== vault.width || probe.height !== vault.height || params.paste.width < probe.width)
  ) {
    method = 'pasted_crop_1x1';
    map = classifyPastedCrop({
      probeRgb: probe.rgb,
      probeW: probe.width,
      probeH: probe.height,
      vaultRgb: vault.rgb,
      vaultW: vault.width,
      vaultH: vault.height,
      paste: params.paste,
      vaultCrop: {
        x: params.paste.vaultX ?? 0,
        y: params.paste.vaultY ?? 0,
        width: params.paste.width,
        height: params.paste.height,
      },
    });
  } else if (probe.width === vault.width && probe.height === vault.height) {
    map = classifyIdentityPixels(probe.rgb, vault.rgb, probe.width, probe.height);
  } else {
    map = new Uint8Array(probe.width * probe.height);
    method = 'geometry_unknown';
  }
  const stats = summarize(map, probe.width, probe.height, vault.width, vault.height);
  return {
    width: probe.width,
    height: probe.height,
    vaultWidth: vault.width,
    vaultHeight: vault.height,
    ...stats,
    method,
  };
}

export function fromPythonPixelSource(raw: Record<string, unknown> | undefined | null): PixelSourceAnalysis | null {
  if (!raw) return null;
  const total = Number(raw.totalPixels);
  if (!Number.isFinite(total) || total < 1) return null;
  return {
    width: Number(raw.width) || 0,
    height: Number(raw.height) || 0,
    vaultWidth: Number(raw.vaultWidth) || 0,
    vaultHeight: Number(raw.vaultHeight) || 0,
    originalPixels: Number(raw.originalPixels) || 0,
    aiSuspectedPixels: Number(raw.aiSuspectedPixels) || 0,
    unknownPixels: Number(raw.unknownPixels) || 0,
    totalPixels: total,
    protectedFromAssetPercent: Number(raw.protectedFromAssetPercent) || 0,
    aiGeneratedPercent: Number(raw.aiGeneratedPercent) || 0,
    otherPercent: Number(raw.otherPercent) || 0,
    originalUsedPercent: Number(raw.originalUsedPercent) || 0,
    regions: Array.isArray(raw.regions) ? raw.regions as PixelSourceRegion[] : [],
    probeRegion: raw.probeRegion as PixelSourceAnalysis['probeRegion'],
    maskPngBase64: typeof raw.maskPngBase64 === 'string' ? raw.maskPngBase64 : undefined,
    overlayPngBase64: typeof raw.overlayPngBase64 === 'string' ? raw.overlayPngBase64 : undefined,
    homographyVaultToProbe: Array.isArray(raw.homographyVaultToProbe)
      ? raw.homographyVaultToProbe as number[]
      : null,
    method: String(raw.method ?? 'python_pixel_source'),
  };
}
