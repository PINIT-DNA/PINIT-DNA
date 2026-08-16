/**
 * Phase 4A — hierarchy architecture / contract tests
 * No cryptographic 4×4/2×2/1×1 tamper detection (that is 4B+).
 */

import {
  buildHierarchyGrid,
  subdivideUnit,
  ancestryForPixel,
  containsRect,
  pixelInUnit,
  verifyExclusiveCoverage,
  verifyAllLevelCoverage,
  planLazyExpansion,
  estimateLazyOpsForRect,
  buildHierarchicalLocalizationContract,
  computeHierarchyUnitCounts,
  estimateMegapixelUnitCounts,
  parentScaleOf,
  childScaleOf,
  unitOrigin,
  SPATIAL_HIERARCHY_PRODUCTION_CLAIM,
  SPATIAL_HIERARCHY_PLANNED_CLAIM,
  isSpatialHierarchyEnabled,
} from '../../src/services/spatial';

describe('Phase 4A — hierarchical architecture 64→8→4→2→1', () => {
  const W = 640;
  const H = 640;

  it('1. hierarchy level chain 64→8→4→2→1', () => {
    expect(parentScaleOf(64)).toBeNull();
    expect(childScaleOf(64)).toBe(8);
    expect(childScaleOf(8)).toBe(4);
    expect(childScaleOf(4)).toBe(2);
    expect(childScaleOf(2)).toBe(1);
    expect(childScaleOf(1)).toBeNull();
    expect(parentScaleOf(1)).toBe(2);
  });

  it('2. 64→8 relationship: 8×8 children contained in 64×64', () => {
    const blocks = buildHierarchyGrid(W, H, 64);
    const b = blocks.find((u) => u.x === 384 && u.y === 448)!;
    const children = subdivideUnit(b, W, H, 8);
    expect(children.length).toBe(64);
    for (const c of children) {
      expect(containsRect(b, c)).toBe(true);
      expect(c.parentId).toBe(b.unitId);
      expect(c.parentScale).toBe(64);
    }
  });

  it('3. 8→4 relationship', () => {
    const cell = buildHierarchyGrid(W, H, 8).find((u) => u.x === 400 && u.y === 496)!;
    const children = subdivideUnit(cell, W, H, 4);
    expect(children.length).toBe(4);
    const origins = children.map((c) => `${c.x},${c.y}`).sort();
    expect(origins).toEqual(['400,496', '400,500', '404,496', '404,500']);
  });

  it('4. 4→2 relationship', () => {
    const u4 = { unitId: 1, scale: 4 as const, x: 400, y: 500, width: 4, height: 4 };
    const children = subdivideUnit(u4, W, H, 2);
    expect(children.length).toBe(4);
    for (const c of children) expect(containsRect(u4, c)).toBe(true);
  });

  it('5. 2→1 relationship', () => {
    const u2 = { unitId: 2, scale: 2 as const, x: 400, y: 500, width: 2, height: 2 };
    const children = subdivideUnit(u2, W, H, 1);
    expect(children.length).toBe(4);
    expect(children.map((c) => `${c.x},${c.y}`).sort()).toEqual([
      '400,500', '400,501', '401,500', '401,501',
    ]);
  });

  it('6. coordinate correctness unitOrigin', () => {
    expect(unitOrigin(64, 400, 500)).toEqual({ x: 384, y: 448 });
    expect(unitOrigin(8, 400, 500)).toEqual({ x: 400, y: 496 });
    expect(unitOrigin(4, 400, 500)).toEqual({ x: 400, y: 500 });
    expect(unitOrigin(2, 400, 500)).toEqual({ x: 400, y: 500 });
    expect(unitOrigin(1, 400, 500)).toEqual({ x: 400, y: 500 });
  });

  it('7. parent-child containment for ancestry', () => {
    const a = ancestryForPixel(W, H, 400, 500);
    expect(containsRect(a.levels['64x64'], a.levels['8x8'])).toBe(true);
    expect(containsRect(a.levels['8x8'], a.levels['4x4'])).toBe(true);
    expect(containsRect(a.levels['4x4'], a.levels['2x2'])).toBe(true);
    expect(containsRect(a.levels['2x2'], a.levels['1x1'])).toBe(true);
  });

  it('8. edge cells on non-divisible dimensions', () => {
    const w = 130;
    const h = 130;
    const g64 = buildHierarchyGrid(w, h, 64);
    const last = g64[g64.length - 1]!;
    expect(last.x + last.width).toBe(w);
    expect(last.y + last.height).toBe(h);
    expect(last.width).toBeLessThan(64);
    const g1 = buildHierarchyGrid(w, h, 1);
    expect(g1.length).toBe(w * h);
  });

  it('9. one-pixel ancestry (400,500)', () => {
    const a = ancestryForPixel(W, H, 400, 500);
    expect(a.levels['64x64']).toMatchObject({ x: 384, y: 448, scale: 64 });
    expect(a.levels['8x8']).toMatchObject({ x: 400, y: 496, width: 8, height: 8 });
    expect(a.levels['4x4']).toMatchObject({ x: 400, y: 500, width: 4, height: 4 });
    expect(a.levels['2x2']).toMatchObject({ x: 400, y: 500, width: 2, height: 2 });
    expect(a.levels['1x1']).toMatchObject({ x: 400, y: 500, width: 1, height: 1 });
    expect(pixelInUnit(a.levels['1x1'], 400, 500)).toBe(true);
    expect(pixelInUnit(a.levels['4x4'], 403, 503)).toBe(true);
    expect(pixelInUnit(a.levels['4x4'], 404, 500)).toBe(false);
  });

  it('10. multiple-pixel ancestry distinct when apart', () => {
    const a = ancestryForPixel(W, H, 10, 10);
    const b = ancestryForPixel(W, H, 200, 200);
    expect(a.levels['8x8'].unitId).not.toBe(b.levels['8x8'].unitId);
    expect(a.levels['1x1'].unitId).not.toBe(b.levels['1x1'].unitId);
  });

  it('11. boundary crossing: pixels on 8×8 edge map to different 4×4', () => {
    const left = ancestryForPixel(W, H, 407, 496);
    const right = ancestryForPixel(W, H, 408, 496);
    expect(left.levels['8x8'].x).toBe(400);
    expect(right.levels['8x8'].x).toBe(408);
    expect(left.levels['4x4'].x).toBe(404);
    expect(right.levels['4x4'].x).toBe(408);
  });

  it('12–13. no duplicate ownership + complete coverage all levels', () => {
    for (const scale of [64, 8, 4, 2, 1] as const) {
      const rep = verifyExclusiveCoverage(130, 130, scale);
      expect(rep.complete).toBe(true);
      expect(rep.overlaps).toBe(0);
      expect(rep.gaps).toBe(0);
    }
    const all = verifyAllLevelCoverage(64, 64);
    expect(all.every((r) => r.complete)).toBe(true);
  });

  it('14. invalid dimensions / OOB pixel', () => {
    expect(() => buildHierarchyGrid(0, 10, 8)).toThrow();
    expect(() => ancestryForPixel(W, H, -1, 0)).toThrow();
    expect(() => ancestryForPixel(W, H, W, 0)).toThrow();
  });

  it('15. feature flag OFF → contract null; claim constants honest', () => {
    expect(isSpatialHierarchyEnabled()).toBe(false);
    expect(buildHierarchicalLocalizationContract({ imageWidth: W, imageHeight: H })).toBeNull();
    expect(SPATIAL_HIERARCHY_PRODUCTION_CLAIM).toBe('8x8_cell');
    expect(SPATIAL_HIERARCHY_PLANNED_CLAIM).toBe('1x1_pixel');
  });

  it('15b. feature flag ON → contract with productionClaim 8x8_cell', () => {
    const prev = process.env['SPATIAL_HIERARCHY_ENABLED'];
    process.env['SPATIAL_HIERARCHY_ENABLED'] = 'true';
    jest.resetModules();
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const mod = require('../../src/services/spatial/hierarchy/contract') as typeof import('../../src/services/spatial/hierarchy/contract');
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const cfg = require('../../src/config/spatial-hierarchy') as typeof import('../../src/config/spatial-hierarchy');
    expect(cfg.isSpatialHierarchyEnabled()).toBe(true);
    const c = mod.buildHierarchicalLocalizationContract({ imageWidth: 64, imageHeight: 64 });
    expect(c).toBeTruthy();
    expect(c!.productionClaim).toBe('8x8_cell');
    expect(c!.plannedClaim).toBe('1x1_pixel');
    expect(c!.cryptoImplementedLevels).toEqual(['64x64', '8x8']);
    expect(c!.canonicalLevels).toEqual(['64x64', '8x8', '4x4', '2x2', '1x1']);
    if (prev === undefined) delete process.env['SPATIAL_HIERARCHY_ENABLED'];
    else process.env['SPATIAL_HIERARCHY_ENABLED'] = prev;
    jest.resetModules();
  });

  it('lazy plan: one failed 8×8 expands to four 4×4', () => {
    const step = planLazyExpansion({
      imageWidth: W,
      imageHeight: H,
      fromLevel: '8x8',
      failedParents: [{ unitId: 1, scale: 8, x: 400, y: 496, width: 8, height: 8 }],
    });
    expect(step.toLevel).toBe('4x4');
    expect(step.childrenToEvaluate.length).toBe(4);
  });

  it('lazy ops estimate for 100×100 region', () => {
    const ops = estimateLazyOpsForRect({
      imageWidth: 3464, imageHeight: 3464, rx: 100, ry: 100, rw: 100, rh: 100,
    });
    expect(ops['1x1']).toBe(10000);
    expect(ops['2x2']).toBeGreaterThan(0);
    expect(ops['64x64']).toBeLessThan(ops['8x8']);
  });

  it('storage counts helper', () => {
    const c = computeHierarchyUnitCounts(1000, 1000);
    expect(c.counts['1x1']).toBe(1_000_000);
    expect(c.counts['8x8']).toBe(15_625);
    expect(c.counts['64x64']).toBe(256);
    const approx = estimateMegapixelUnitCounts(12);
    expect(approx['1x1']).toBeGreaterThan(11_000_000);
  });
});
