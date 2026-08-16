/**
 * Phase 3C — fine tamper map UX / hierarchical drill-down tests
 * Visualization only — does not change Phase 1/2/3A crypto.
 */

import sharp from 'sharp';
import {
  buildSpatialAuthPackageFromRgb,
  buildPixelAuthPackageFromRgb,
  verifyExactSpatialAuth,
  buildSpatialInvestigation,
  drillDownBlock,
  buildFineTamperMask,
  attachSpatialLocalizationToImageDiff,
  spatialLocalizationForTamperAnalysis,
} from '../../src/services/spatial';
import type { SpatialAuthPackageData } from '../../src/services/spatial/types';
import type { ImageDiffResult } from '../../src/types/forensic-diff.types';

const MASTER = 'phase3c-investigation-secret';
const KEY = 'spatial-key-v1';
const DNA = '3c-dna-1111-4111-8111-111111111111';
const OWNER = '3c-owner-2222-4222-8222-222222222222';
const REF = 'seal:phase3c';

function setPixel(rgb: Buffer, w: number, x: number, y: number, r: number, g: number, b: number): void {
  const i = (y * w + x) * 3;
  rgb[i] = r;
  rgb[i + 1] = g;
  rgb[i + 2] = b;
}

function fillRect(
  rgb: Buffer, w: number,
  x0: number, y0: number, rw: number, rh: number,
  r: number, g: number, b: number,
): void {
  for (let y = y0; y < y0 + rh; y++) {
    for (let x = x0; x < x0 + rw; x++) setPixel(rgb, w, x, y, r, g, b);
  }
}

async function patterned(w: number, h: number): Promise<{ rgb: Buffer; width: number; height: number }> {
  const { data, info } = await sharp({
    create: { width: w, height: h, channels: 3, background: { r: 18, g: 36, b: 54 } },
  }).raw().toBuffer({ resolveWithObject: true });
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      setPixel(data, w, x, y, (x * 3) % 256, (y * 5) % 256, (x + y) % 256);
    }
  }
  return { rgb: data, width: info.width, height: info.height };
}

function enrollFull(rgb: Buffer, width: number, height: number): SpatialAuthPackageData {
  const { packageData } = buildSpatialAuthPackageFromRgb({
    rgb, width, height,
    dnaRecordId: DNA, ownerUserId: OWNER, globalDnaRef: REF,
    scales: [64, 128], primaryScale: 64, keyId: KEY, masterSecret: MASTER,
  });
  const { pixel } = buildPixelAuthPackageFromRgb({
    rgb, width, height,
    dnaRecordId: DNA, ownerUserId: OWNER, globalDnaRef: REF,
    keyId: KEY, tagBytes: 8, masterSecret: MASTER,
  });
  return {
    ...packageData,
    pixelAlgoVersion: pixel.algorithmVersion,
    pixelScheme: pixel.scheme,
    pixelKeyId: pixel.keyId,
    pixelCellSize: pixel.cellSize,
    pixelTagBytes: pixel.tagBytes,
    pixelAuthBlob: pixel.pixelAuthBlob,
    pixelAuthRoot: pixel.pixelAuthRoot,
    pixelRootMac: pixel.pixelRootMac,
  };
}

describe('Spatial Auth Phase 3C — investigation / drill-down', () => {
  let origRgb: Buffer;
  let width: number;
  let height: number;
  let pkg: SpatialAuthPackageData;

  beforeAll(async () => {
    const img = await patterned(640, 640);
    origRgb = img.rgb;
    width = img.width;
    height = img.height;
    pkg = enrollFull(origRgb, width, height);
  });

  // 1
  it('1. Hierarchical block → cell mapping', () => {
    const t = Buffer.from(origRgb);
    setPixel(t, width, 400, 500, 255, 0, 0);
    const result = verifyExactSpatialAuth({
      packageData: pkg, candidateRgb: t, candidateWidth: width, candidateHeight: height, masterSecret: MASTER,
    });
    expect(result.investigation).toBeTruthy();
    const inv = result.investigation!;
    expect(inv.derivedEvidenceOnly).toBe(true);
    expect(inv.visualizationOnly).toBe(true);
    expect(inv.trusted).toBe(true);
    expect(inv.localizationClaim).toBe('8x8_cell');

    const tb = inv.hierarchicalBlocks.find((b) => b.status === 'TAMPERED');
    expect(tb).toBeTruthy();
    expect(tb!.fineLocalization).toBeTruthy();
    expect(tb!.fineLocalization!.localizationClaim).toBe('8x8_cell');
    expect(tb!.fineLocalization!.tamperedCells.length).toBeGreaterThanOrEqual(1);
    const cell = tb!.fineLocalization!.tamperedCells[0]!;
    expect(400 >= cell.x && 400 < cell.x + cell.width).toBe(true);
    expect(500 >= cell.y && 500 < cell.y + cell.height).toBe(true);
    // Coordinates nested under block
    expect(cell.x >= tb!.x && cell.x + cell.width <= tb!.x + tb!.width).toBe(true);
  });

  // 2
  it('2. One-pixel visualization (400,500)', () => {
    const t = Buffer.from(origRgb);
    setPixel(t, width, 400, 500, 1, 2, 3);
    const result = verifyExactSpatialAuth({
      packageData: pkg, candidateRgb: t, candidateWidth: width, candidateHeight: height, masterSecret: MASTER,
    });
    const inv = result.investigation!;
    expect(inv.overlay).toBeTruthy();
    expect(inv.overlay!.fineRects.length).toBe(1);
    const fr = inv.overlay!.fineRects[0]!;
    expect(fr.x).toBe(400);
    expect(fr.y).toBe(496);
    expect(fr.width).toBe(8);
    expect(fr.height).toBe(8);
    expect(fr.status).toBe('TAMPERED');
    expect(inv.stats!.tampered8x8Cells).toBe(1);
    expect(inv.localizationClaim).toBe('8x8_cell');
    expect(inv.claimDisclaimer.toLowerCase()).toContain('8×8');
    expect(inv.claimDisclaimer.toLowerCase()).not.toContain('proven to be modified');
  });

  // 3
  it('3. 10×10 visualization', () => {
    const t = Buffer.from(origRgb);
    fillRect(t, width, 200, 200, 10, 10, 255, 0, 0);
    const result = verifyExactSpatialAuth({
      packageData: pkg, candidateRgb: t, candidateWidth: width, candidateHeight: height, masterSecret: MASTER,
    });
    const inv = result.investigation!;
    expect(inv.overlay!.fineRects.length).toBe(4);
    expect(inv.stats!.tampered8x8Cells).toBe(4);
    for (const r of inv.overlay!.fineRects) {
      expect(r.x < 210 && r.x + r.width > 200).toBe(true);
      expect(r.y < 210 && r.y + r.height > 200).toBe(true);
    }
  });

  // 4
  it('4. 64×64 visualization — all nested cells tampered', () => {
    const t = Buffer.from(origRgb);
    fillRect(t, width, 128, 128, 64, 64, 9, 9, 9);
    const result = verifyExactSpatialAuth({
      packageData: pkg, candidateRgb: t, candidateWidth: width, candidateHeight: height, masterSecret: MASTER,
    });
    const inv = result.investigation!;
    expect(inv.stats!.tampered64x64Blocks).toBe(1);
    const hb = inv.hierarchicalBlocks.find((b) => b.x === 128 && b.y === 128 && b.status === 'TAMPERED');
    expect(hb).toBeTruthy();
    expect(hb!.fineLocalization!.cells.length).toBe(64);
    expect(hb!.fineLocalization!.tamperedCells.length).toBe(64);
    expect(inv.overlay!.fineRects.length).toBe(64);
  });

  // 5
  it('5. Multiple separated regions', () => {
    const t = Buffer.from(origRgb);
    setPixel(t, width, 16, 16, 255, 0, 0);
    setPixel(t, width, 320, 320, 255, 0, 0);
    setPixel(t, width, 560, 560, 255, 0, 0);
    const result = verifyExactSpatialAuth({
      packageData: pkg, candidateRgb: t, candidateWidth: width, candidateHeight: height, masterSecret: MASTER,
    });
    const inv = result.investigation!;
    expect(inv.regions.length).toBe(3);
    expect(inv.stats!.numberOfRegions).toBe(3);
    expect(inv.stats!.tampered8x8Cells).toBe(3);
    for (const r of inv.regions) {
      expect(r.tampered64x64Blocks).toBeGreaterThanOrEqual(1);
      expect(r.tampered8x8Cells).toBeGreaterThanOrEqual(1);
      expect(r.affectedAreaPixels).toBeGreaterThan(0);
    }
  });

  // 6
  it('6. Boundary cells coordinates correct', () => {
    const t = Buffer.from(origRgb);
    // On 8×8 boundary
    setPixel(t, width, 63, 20, 255, 0, 0);
    setPixel(t, width, 64, 20, 255, 0, 0);
    const result = verifyExactSpatialAuth({
      packageData: pkg, candidateRgb: t, candidateWidth: width, candidateHeight: height, masterSecret: MASTER,
    });
    const inv = result.investigation!;
    expect(inv.overlay!.fineRects.length).toBe(2);
    const xs = inv.overlay!.fineRects.map((r) => r.x).sort((a, b) => a - b);
    expect(xs).toEqual([56, 64]);
  });

  // 7
  it('7. Edge / partial blocks', async () => {
    const img = await patterned(200, 200);
    const edgePkg = enrollFull(img.rgb, img.width, img.height);
    const t = Buffer.from(img.rgb);
    setPixel(t, img.width, 199, 199, 255, 0, 0);
    const result = verifyExactSpatialAuth({
      packageData: edgePkg,
      candidateRgb: t,
      candidateWidth: img.width,
      candidateHeight: img.height,
      masterSecret: MASTER,
    });
    const inv = result.investigation!;
    expect(inv.trusted).toBe(true);
    expect(inv.overlay!.fineRects.length).toBe(1);
    const fr = inv.overlay!.fineRects[0]!;
    expect(fr.x + fr.width).toBeLessThanOrEqual(img.width);
    expect(fr.y + fr.height).toBeLessThanOrEqual(img.height);
    expect(199 >= fr.x && 199 < fr.x + fr.width).toBe(true);
  });

  // 8
  it('8. Coordinate correctness vs Phase 2/3A sources', () => {
    const t = Buffer.from(origRgb);
    setPixel(t, width, 400, 500, 7, 7, 7);
    const result = verifyExactSpatialAuth({
      packageData: pkg, candidateRgb: t, candidateWidth: width, candidateHeight: height, masterSecret: MASTER,
    });
    const inv = result.investigation!;
    const p2 = result.localization!.tamperedBlocks[0]!;
    const p3 = result.fineLocalization!.tamperedCells[0]!;
    const hb = inv.hierarchicalBlocks.find((b) => b.blockId === p2.blockId)!;
    expect(hb.x).toBe(p2.x);
    expect(hb.y).toBe(p2.y);
    expect(hb.fineLocalization!.tamperedCells[0]!.x).toBe(p3.x);
    expect(hb.fineLocalization!.tamperedCells[0]!.y).toBe(p3.y);
    expect(inv.overlay!.fineRects[0]!.x).toBe(p3.x);
  });

  // 9
  it('9. Mask dimensions (cell-byte-v1)', () => {
    const result = verifyExactSpatialAuth({
      packageData: pkg, candidateRgb: origRgb, candidateWidth: width, candidateHeight: height, masterSecret: MASTER,
    });
    const mask = result.investigation!.fineMask!;
    expect(mask.format).toBe('cell-byte-v1');
    expect(mask.imageWidth).toBe(640);
    expect(mask.imageHeight).toBe(640);
    expect(mask.cellSize).toBe(8);
    expect(mask.gridCols).toBe(80);
    expect(mask.gridRows).toBe(80);
    expect(mask.cellCount).toBe(6400);
    expect(mask.byteLength).toBe(6400);
    const bytes = Buffer.from(mask.dataBase64, 'base64');
    expect(bytes.length).toBe(6400);
    expect([...bytes].every((b) => b === 0)).toBe(true); // all AUTHENTIC

    const t = Buffer.from(origRgb);
    setPixel(t, width, 0, 0, 1, 1, 1);
    const tampered = verifyExactSpatialAuth({
      packageData: pkg, candidateRgb: t, candidateWidth: width, candidateHeight: height, masterSecret: MASTER,
    });
    const mb = Buffer.from(tampered.investigation!.fineMask!.dataBase64, 'base64');
    expect(mb[0]).toBe(1); // TAMPERED
  });

  // 10
  it('10. Localization claim always 8x8_cell', () => {
    const t = Buffer.from(origRgb);
    setPixel(t, width, 10, 10, 2, 2, 2);
    const result = verifyExactSpatialAuth({
      packageData: pkg, candidateRgb: t, candidateWidth: width, candidateHeight: height, masterSecret: MASTER,
    });
    expect(result.investigation!.localizationClaim).toBe('8x8_cell');
    expect(result.investigation!.stats!.localizationClaim).toBe('8x8_cell');
    expect(result.investigation!.overlay!.localizationClaim).toBe('8x8_cell');
    expect(result.fineLocalization!.localizationClaim).toBe('8x8_cell');
  });

  // 11
  it('11. Invalid package — no trusted overlay/fine map', () => {
    const bad = {
      ...pkg,
      rootMac: '00'.repeat(32),
    };
    const result = verifyExactSpatialAuth({
      packageData: bad, candidateRgb: origRgb, candidateWidth: width, candidateHeight: height, masterSecret: MASTER,
    });
    expect(result.status).toBe('INVALID_AUTH_PACKAGE');
    expect(result.investigation!.trusted).toBe(false);
    expect(result.investigation!.overlay).toBeNull();
    expect(result.investigation!.fineMask).toBeNull();
    expect(result.investigation!.hierarchicalBlocks.length).toBe(0);

    const badPixel = {
      ...pkg,
      pixelRootMac: '11'.repeat(32),
    };
    const result2 = verifyExactSpatialAuth({
      packageData: badPixel, candidateRgb: origRgb, candidateWidth: width, candidateHeight: height, masterSecret: MASTER,
    });
    // Phase 1/2 may still be MATCH; fine must not be trusted
    expect(result2.pixelLayer?.status).toBe('INVALID_PIXEL_PACKAGE');
    expect(result2.investigation!.fineMask).toBeNull();
    expect(result2.investigation!.overlay?.fineRects.length ?? 0).toBe(0);
  });

  // Scenario A
  it('Scenario A: no modification — empty overlay', () => {
    const result = verifyExactSpatialAuth({
      packageData: pkg, candidateRgb: origRgb, candidateWidth: width, candidateHeight: height, masterSecret: MASTER,
    });
    const inv = result.investigation!;
    expect(result.status).toBe('MATCH');
    expect(inv.stats!.tampered64x64Blocks).toBe(0);
    expect(inv.stats!.tampered8x8Cells).toBe(0);
    expect(inv.regions.length).toBe(0);
    expect(inv.overlay!.coarseRects.length).toBe(0);
    expect(inv.overlay!.fineRects.length).toBe(0);
  });

  // Drill-down helper
  it('drillDownBlock returns nested fine grid', () => {
    const t = Buffer.from(origRgb);
    setPixel(t, width, 400, 500, 3, 3, 3);
    const result = verifyExactSpatialAuth({
      packageData: pkg, candidateRgb: t, candidateWidth: width, candidateHeight: height, masterSecret: MASTER,
    });
    const blockId = result.localization!.tamperedBlocks[0]!.blockId;
    const drilled = drillDownBlock(result.investigation!, blockId);
    expect(drilled).toBeTruthy();
    expect(drilled!.fineLocalization!.gridCols).toBe(8);
    expect(drilled!.fineLocalization!.gridRows).toBe(8);
    expect(drilled!.fineLocalization!.cells.length).toBe(64);
  });

  // Integration adapters
  it('integration: attach + tamper-analysis summary include investigation', () => {
    const t = Buffer.from(origRgb);
    setPixel(t, width, 400, 500, 4, 4, 4);
    const result = verifyExactSpatialAuth({
      packageData: pkg, candidateRgb: t, candidateWidth: width, candidateHeight: height, masterSecret: MASTER,
    });
    const diff: ImageDiffResult = {
      supported: true,
      dimensionsMatch: true,
      widthA: width,
      heightA: height,
      widthB: width,
      heightB: height,
      pixelDifferencePercent: 0,
      resizeDetected: false,
      cropDetected: false,
      compressionChanged: false,
      changedRegions: [],
      changedRegionPercent: 0,
      gridSize: 8,
      heatmapAvailable: false,
      visualDescription: 'test',
    };
    const attached = attachSpatialLocalizationToImageDiff(diff, result);
    expect(attached.spatialInvestigation).toBeTruthy();
    expect((attached.spatialInvestigation as { localizationClaim: string }).localizationClaim).toBe('8x8_cell');

    const summary = spatialLocalizationForTamperAnalysis(result);
    expect(summary?.['localizationClaim']).toBe('8x8_cell');
    expect(summary?.['overlay']).toBeTruthy();
    expect(summary?.['hierarchicalBlocks']).toBeTruthy();
  });

  // Performance overhead of 3C builder only
  it('performance: investigation build overhead is small vs verify', () => {
    const t = Buffer.from(origRgb);
    setPixel(t, width, 100, 100, 5, 5, 5);
    const result = verifyExactSpatialAuth({
      packageData: pkg, candidateRgb: t, candidateWidth: width, candidateHeight: height, masterSecret: MASTER,
    });
    // Strip investigation and rebuild timing
    const { investigation: _i, ...core } = result;
    const t0 = Date.now();
    const rebuilt = buildSpatialInvestigation(core as typeof result);
    const ms = Date.now() - t0;
    expect(rebuilt.investigationMs).toBeLessThan(500);
    expect(ms).toBeLessThan(500);
    // Crypto verify dominates; 3C should be << typical verify (~hundreds ms+)
    expect(result.verificationMs).toBeGreaterThan(0);
    // eslint-disable-next-line no-console
    console.log(
      `[3c-perf] investigationMs=${rebuilt.investigationMs} verifyMs=${result.verificationMs} ` +
        `pixelMs=${result.pixelVerificationMs ?? 0} overlayFineRects=${rebuilt.overlay?.fineRects.length ?? 0} ` +
        `fineMaskBytes=${rebuilt.fineMask?.byteLength ?? 0}`,
    );
  });

  it('buildFineTamperMask encoding 0/1/2', () => {
    const mask = buildFineTamperMask({
      imageWidth: 16,
      imageHeight: 8,
      cellSize: 8,
      cells: [
        { cellId: 0, x: 0, y: 0, width: 8, height: 8, status: 'AUTHENTIC' },
        { cellId: 1, x: 8, y: 0, width: 8, height: 8, status: 'TAMPERED' },
      ],
    });
    const bytes = Buffer.from(mask.dataBase64, 'base64');
    expect(bytes[0]).toBe(0);
    expect(bytes[1]).toBe(1);
  });

  it('multiScale reserves future 4×4 without implementing it', () => {
    const result = verifyExactSpatialAuth({
      packageData: pkg, candidateRgb: origRgb, candidateWidth: width, candidateHeight: height, masterSecret: MASTER,
    });
    expect(result.investigation!.multiScale.availableScales).toEqual([64, 8]);
    expect(result.investigation!.multiScale.futureScalesReserved).toContain(4);
    expect(result.investigation!.multiScale.fineScale).toBe(8);
  });
});
