import sharp from 'sharp';
import {
  buildPixelSourceAnalysis,
  classifyIdentityPixels,
  classifyPastedCrop,
  PIXEL_CLASS,
} from '../../src/services/forensics/pixel-source-map.service';

function fillRgb(w: number, h: number, fn: (x: number, y: number) => [number, number, number]): Buffer {
  const rgb = Buffer.alloc(w * h * 3);
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const [r, g, b] = fn(x, y);
      const i = (y * w + x) * 3;
      rgb[i] = r;
      rgb[i + 1] = g;
      rgb[i + 2] = b;
    }
  }
  return rgb;
}

function clone(buf: Buffer): Buffer {
  return Buffer.from(buf);
}

async function toPng(rgb: Buffer, w: number, h: number): Promise<Buffer> {
  return sharp(rgb, { raw: { width: w, height: h, channels: 3 } }).png().toBuffer();
}

describe('pixel source map (vault content inside another image)', () => {
  const VW = 48;
  const VH = 48;

  it('TEST 1 — exact original is ~100% vault pixels', async () => {
    const vault = fillRgb(VW, VH, (x, y) => [x * 4, y * 4, 80]);
    const result = await buildPixelSourceAnalysis({
      probeBuffer: await toPng(vault, VW, VH),
      vaultBuffer: await toPng(vault, VW, VH),
    });
    expect(result.protectedFromAssetPercent).toBeGreaterThanOrEqual(99);
    expect(result.originalPixels + result.aiSuspectedPixels + result.unknownPixels).toBe(result.totalPixels);
    expect(result.totalPixels).toBe(VW * VH);
  });

  it('TEST 2 — unrelated canvas has 0% vault pixels', async () => {
    const vault = fillRgb(VW, VH, (x, y) => [x * 4, y * 4, 80]);
    const other = fillRgb(64, 40, (x, y) => [200, (x + y) % 40, 10]);
    const result = await buildPixelSourceAnalysis({
      probeBuffer: await toPng(other, 64, 40),
      vaultBuffer: await toPng(vault, VW, VH),
    });
    expect(result.protectedFromAssetPercent).toBe(0);
    expect(result.originalPixels).toBe(0);
  });

  it('TEST 3 — vault crop pasted into AI host is green only in the paste', async () => {
    const vault = fillRgb(VW, VH, (x, y) => [x * 5, y * 3, 120]);
    const hostW = 96;
    const hostH = 72;
    const host = fillRgb(hostW, hostH, () => [30, 90, 160]);
    const cropW = 24;
    const cropH = 32;
    const dx = 40;
    const dy = 12;
    for (let row = 0; row < cropH; row++) {
      vault.copy(
        host,
        ((dy + row) * hostW + dx) * 3,
        (row * VW) * 3,
        (row * VW) * 3 + cropW * 3,
      );
    }
    const result = await buildPixelSourceAnalysis({
      probeBuffer: await toPng(host, hostW, hostH),
      vaultBuffer: await toPng(vault, VW, VH),
      paste: { x: dx, y: dy, width: cropW, height: cropH, vaultX: 0, vaultY: 0 },
    });
    expect(result.originalPixels).toBe(cropW * cropH);
    expect(result.protectedFromAssetPercent).toBeCloseTo((cropW * cropH) / (hostW * hostH) * 100, 0);
    expect(result.aiGeneratedPercent).toBeCloseTo(100 - result.protectedFromAssetPercent, 0);
    expect(result.regions[0]?.uploadedBounds.x).toBe(dx);
    expect(result.regions[0]?.uploadedBounds.y).toBe(dy);
  });

  it('TEST 4 — same crop at a new location is green at the new coordinates', () => {
    const vault = fillRgb(32, 32, (x, y) => [x * 7, y * 7, 50]);
    const host = fillRgb(80, 60, () => [8, 8, 8]);
    const paste = { x: 50, y: 20, width: 16, height: 16 };
    for (let row = 0; row < 16; row++) {
      vault.copy(host, ((paste.y + row) * 80 + paste.x) * 3, (row * 32) * 3, (row * 32) * 3 + 16 * 3);
    }
    const map = classifyPastedCrop({
      probeRgb: host,
      probeW: 80,
      probeH: 60,
      vaultRgb: vault,
      vaultW: 32,
      vaultH: 32,
      paste,
      vaultCrop: { x: 0, y: 0, width: 16, height: 16 },
    });
    expect(map[20 * 80 + 50]).toBe(PIXEL_CLASS.VAULT);
    expect(map[0]).toBe(PIXEL_CLASS.NON_VAULT);
    expect(map[12 * 80 + 12]).toBe(PIXEL_CLASS.NON_VAULT);
  });

  it('TEST 7 — one pixel change is not green; the rest stay vault', () => {
    const vault = fillRgb(24, 24, (x, y) => [x * 9, y * 9, 40]);
    const probe = clone(vault);
    const i = (10 * 24 + 10) * 3;
    probe[i] = (probe[i]! + 40) % 256;
    const map = classifyIdentityPixels(probe, vault, 24, 24);
    const changed = map[10 * 24 + 10];
    expect(changed).not.toBe(PIXEL_CLASS.VAULT);
    let green = 0;
    for (let p = 0; p < map.length; p++) if (map[p] === PIXEL_CLASS.VAULT) green += 1;
    expect(green).toBe(24 * 24 - 1);
  });

  it('TEST 8 — ten modified pixels inside a paste are not green', () => {
    const vault = fillRgb(32, 32, (x, y) => [x * 6, y * 6, 90]);
    const host = fillRgb(64, 48, () => [12, 40, 70]);
    const paste = { x: 8, y: 8, width: 16, height: 16 };
    for (let row = 0; row < 16; row++) {
      vault.copy(host, ((paste.y + row) * 64 + paste.x) * 3, (row * 32) * 3, (row * 32) * 3 + 16 * 3);
    }
    for (let k = 0; k < 10; k++) {
      const x = paste.x + k;
      const y = paste.y + 1;
      const o = (y * 64 + x) * 3;
      host[o] = 255;
      host[o + 1] = 0;
      host[o + 2] = 0;
    }
    const map = classifyPastedCrop({
      probeRgb: host,
      probeW: 64,
      probeH: 48,
      vaultRgb: vault,
      vaultW: 32,
      vaultH: 32,
      paste,
      vaultCrop: { x: 0, y: 0, width: 16, height: 16 },
    });
    let green = 0;
    for (let p = 0; p < map.length; p++) if (map[p] === PIXEL_CLASS.VAULT) green += 1;
    expect(green).toBe(16 * 16 - 10);
  });
});
