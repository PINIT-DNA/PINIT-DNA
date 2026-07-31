/**
 * Milestone E — Enterprise 15-Layer Comparison Engine.
 */
import {
  EnterpriseComparisonEngine,
  compareEnterpriseLayer,
  packageFromEphemeralFingerprint,
  validateCompareVersions,
} from '../../src/services/verification/enterprise-comparison-engine.service';
import type {
  EnterpriseComparePackageInput,
} from '../../src/types/enterprise-comparison.types';
import {
  DNA_ALGORITHM_VERSION,
  DNA_FINGERPRINT_VERSION,
  DNA_SCHEMA_VERSION,
} from '../../src/config/dna-versions';

function layer(
  n: number,
  fingerprint: string,
  present = true,
): EnterpriseComparePackageInput['layers'][number] {
  return {
    layerNumber: n,
    layerName: `L${n}`,
    fingerprint: present ? fingerprint : '',
    fingerprintAlgorithm: `L${n}-algo`,
    fingerprintVersion: DNA_FINGERPRINT_VERSION,
    present,
  };
}

function pkg(
  id: string,
  fingerprints: Array<string | null>,
): EnterpriseComparePackageInput {
  return {
    dnaId: id,
    mediaType: 'IMAGE',
    contentId: fingerprints[0] ?? undefined,
    dnaSchemaVersion: DNA_SCHEMA_VERSION,
    dnaAlgorithmVersion: DNA_ALGORITHM_VERSION,
    fingerprintVersion: DNA_FINGERPRINT_VERSION,
    layers: fingerprints.map((fp, i) => layer(i + 1, fp ?? '', fp != null)),
  };
}

describe('enterprise-comparison-engine (Milestone E)', () => {
  const engine = new EnterpriseComparisonEngine();

  it('exact original → MATCH on L1 and independent domain scores', () => {
    const fps = Array.from({ length: 15 }, (_, i) => `fp${(i + 1).toString().padStart(2, '0')}${'a'.repeat(60)}`.slice(0, 64));
    const stored = pkg('stored', fps);
    const probe = pkg('probe', fps);
    const report = engine.comparePackages(stored, probe);

    expect(report.layers).toHaveLength(15);
    expect(report.layers[0]!.status).toBe('MATCH');
    expect(report.layers[0]!.score).toBe(100);
    expect(report.domains.identityScore).toBeGreaterThan(0);
    expect(report.domains).toHaveProperty('evidenceScore');
    expect(report.domains).toHaveProperty('ownershipScore');
    expect(report.domains).toHaveProperty('trustScore');
    // Domains are independent fields — not a single fused percentage object
    expect(Object.keys(report.domains).sort()).toEqual([
      'evidenceScore',
      'identityScore',
      'ownershipScore',
      'trustScore',
    ]);
  });

  it('compressed / resized near-duplicate → PARTIAL perceptual (L3)', () => {
    const stored = pkg('stored', [
      '1'.repeat(64),
      '2'.repeat(64),
      'aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa',
      ...Array.from({ length: 12 }, () => 'x'.repeat(64)),
    ]);
    const probe = pkg('probe', [
      '9'.repeat(64), // different L1 (re-encode)
      '2'.repeat(64),
      'aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaab', // 1 nibble flip
      ...Array.from({ length: 12 }, () => 'x'.repeat(64)),
    ]);
    const l3 = compareEnterpriseLayer(3, stored, probe);
    expect(['MATCH', 'PARTIAL']).toContain(l3.status);
    expect(l3.score).toBeGreaterThan(50);
    expect(compareEnterpriseLayer(1, stored, probe).status).toBe('MISMATCH');
  });

  it('metadata stripped → L5 NOT_PRESENT on probe', () => {
    const stored = pkg('stored', Array.from({ length: 15 }, (_, i) => (i === 4 ? 'meta'.padEnd(64, '0') : `f${i}`.padEnd(64, '0'))));
    const probeLayers = stored.layers.map((l) =>
      l.layerNumber === 5 ? { ...l, fingerprint: '', present: false } : l,
    );
    const probe = { ...stored, dnaId: 'probe', layers: probeLayers };
    const l5 = compareEnterpriseLayer(5, stored, probe);
    expect(l5.status).toBe('NOT_PRESENT');
    expect(l5.reason).toBe('probe_absent');
    expect(l5.domain).toBe('evidence');
  });

  it('watermark / ownership removed → L12/L14 NOT_PRESENT', () => {
    const fps = Array.from({ length: 15 }, (_, i) => `f${i}`.padEnd(64, 'a'));
    const stored = pkg('stored', fps);
    const probeLayers = stored.layers.map((l) =>
      (l.layerNumber === 12 || l.layerNumber === 14)
        ? { ...l, fingerprint: '', present: false }
        : l,
    );
    const probe = { ...stored, dnaId: 'probe', layers: probeLayers };
    expect(compareEnterpriseLayer(12, stored, probe).status).toBe('NOT_PRESENT');
    expect(compareEnterpriseLayer(14, stored, probe).status).toBe('NOT_PRESENT');
    expect(compareEnterpriseLayer(12, stored, probe).domain).toBe('ownership');
  });

  it('certificate / custody removed → L13 NOT_PRESENT', () => {
    const fps = Array.from({ length: 15 }, (_, i) => `f${i}`.padEnd(64, 'b'));
    const stored = pkg('stored', fps);
    const probe = {
      ...stored,
      dnaId: 'probe',
      layers: stored.layers.map((l) =>
        l.layerNumber === 13 ? { ...l, fingerprint: '', present: false } : l,
      ),
    };
    const l13 = compareEnterpriseLayer(13, stored, probe);
    expect(l13.status).toBe('NOT_PRESENT');
    expect(l13.domain).toBe('evidence');
  });

  it('cropped / screenshot style mismatch on structural keeps perceptual graded', () => {
    const stored = pkg('stored', [
      '1'.repeat(64),
      '0'.repeat(64),
      'percept'.padEnd(64, 'c'),
      ...Array.from({ length: 12 }, () => 'z'.repeat(64)),
    ]);
    const probe = pkg('probe', [
      '2'.repeat(64),
      'f'.repeat(64),
      'percept'.padEnd(64, 'c'),
      ...Array.from({ length: 12 }, () => 'z'.repeat(64)),
    ]);
    expect(compareEnterpriseLayer(2, stored, probe).status).toBe('MISMATCH');
    expect(compareEnterpriseLayer(3, stored, probe).status).toBe('MATCH');
  });

  it('video/audio/screen slots report via L8/L9/L10 similarity or exact', () => {
    const fps = Array.from({ length: 15 }, (_, i) => `v${i}`.padEnd(64, 'd'));
    const stored = pkg('stored', fps);
    const same = engine.comparePackages(stored, { ...stored, dnaId: 'probe' });
    expect(same.layers.find((l) => l.layerId === 8)?.status).toBe('MATCH');
    expect(same.layers.find((l) => l.layerId === 9)?.status).toBe('MATCH');
    expect(same.layers.find((l) => l.layerId === 10)?.status).toBe('MATCH');
  });

  it('version validation flags algorithm drift without aborting', () => {
    const stored = pkg('stored', Array.from({ length: 15 }, () => 'a'.repeat(64)));
    const probe = {
      ...pkg('probe', Array.from({ length: 15 }, () => 'a'.repeat(64))),
      dnaAlgorithmVersion: 'other-suite',
    };
    const v = validateCompareVersions(stored, probe);
    expect(v.ok).toBe(false);
    expect(v.reasons.some((r) => r.includes('algorithm_version_mismatch'))).toBe(true);
    const report = engine.comparePackages(stored, probe);
    expect(report.layers).toHaveLength(15);
  });

  it('every layer result includes required contract fields', () => {
    const fps = Array.from({ length: 15 }, (_, i) => `c${i}`.padEnd(64, 'e'));
    const report = engine.comparePackages(pkg('a', fps), pkg('b', fps));
    for (const layerResult of report.layers) {
      expect(layerResult).toEqual(expect.objectContaining({
        layerId: expect.any(Number),
        score: expect.any(Number),
        confidence: expect.any(Number),
        status: expect.stringMatching(/^(MATCH|PARTIAL|MISMATCH|NOT_PRESENT|ERROR)$/),
        reason: expect.any(String),
        executionTimeMs: expect.any(Number),
      }));
    }
  });

  it('builds probe package from ephemeral fingerprint without DB', () => {
    const probe = packageFromEphemeralFingerprint({
      fileType: 'IMAGE',
      mimeType: 'image/jpeg',
      filename: 'probe.jpg',
      sizeBytes: 10,
      detectedBy: 'test',
      layers: [
        { layer: 1, name: 'crypto', implementation: 'L1', fingerprint: 'a'.repeat(64), data: {}, success: true },
        { layer: 3, name: 'perc', implementation: 'L3', fingerprint: 'b'.repeat(64), data: {}, success: true },
      ],
    });
    expect(probe.layers).toHaveLength(15);
    expect(probe.layers[0]!.present).toBe(true);
    expect(probe.layers[2]!.present).toBe(true);
    expect(probe.layers[1]!.present).toBe(false);
  });
});
