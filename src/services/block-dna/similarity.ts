/** Mean absolute channel difference 0–255. */
export function meanAbsDiff(a: Buffer, b: Buffer): number {
  const n = Math.min(a.length, b.length);
  if (n === 0) return 255;
  let s = 0;
  for (let i = 0; i < n; i++) s += Math.abs(a[i]! - b[i]!);
  if (a.length !== b.length) s += Math.abs(a.length - b.length) * 255;
  return s / Math.max(a.length, b.length);
}

export function pixelSimilarity(a: Buffer, b: Buffer): number {
  return Math.max(0, Math.min(1, 1 - meanAbsDiff(a, b) / 255));
}

/** Tiny-block SSIM on luma. */
export function structuralSimilarity(a: Buffer, b: Buffer): number {
  const n = Math.floor(Math.min(a.length, b.length) / 3);
  if (n < 1) return 0;
  const ya: number[] = [];
  const yb: number[] = [];
  for (let i = 0; i < n; i++) {
    const o = i * 3;
    ya.push(0.299 * a[o]! + 0.587 * a[o + 1]! + 0.114 * a[o + 2]!);
    yb.push(0.299 * b[o]! + 0.587 * b[o + 1]! + 0.114 * b[o + 2]!);
  }
  let meanA = 0;
  let meanB = 0;
  for (let i = 0; i < n; i++) {
    meanA += ya[i]!;
    meanB += yb[i]!;
  }
  meanA /= n;
  meanB /= n;
  let varA = 0;
  let varB = 0;
  let cov = 0;
  for (let i = 0; i < n; i++) {
    const da = ya[i]! - meanA;
    const db = yb[i]! - meanB;
    varA += da * da;
    varB += db * db;
    cov += da * db;
  }
  varA /= n;
  varB /= n;
  cov /= n;
  const c1 = 6.5025;
  const c2 = 58.5225;
  const num = (2 * meanA * meanB + c1) * (2 * cov + c2);
  const den = (meanA * meanA + meanB * meanB + c1) * (varA + varB + c2);
  if (den <= 0) return 0;
  return Math.max(0, Math.min(1, num / den));
}

export function firstDifferingPixel(
  a: Buffer,
  b: Buffer,
  width: number,
  _height: number,
  originX: number,
  originY: number,
): { x: number; y: number } | undefined {
  const n = Math.min(a.length, b.length);
  for (let i = 0; i + 2 < n; i += 3) {
    if (a[i] !== b[i] || a[i + 1] !== b[i + 1] || a[i + 2] !== b[i + 2]) {
      const p = i / 3;
      const lx = p % width;
      const ly = Math.floor(p / width);
      return { x: originX + lx, y: originY + ly };
    }
  }
  return undefined;
}

export function contentKey(rgb: Buffer): string {
  let h = 2166136261;
  for (let i = 0; i < rgb.length; i++) {
    h ^= rgb[i]!;
    h = Math.imul(h, 16777619);
  }
  return (h >>> 0).toString(16) + ':' + rgb.length;
}
