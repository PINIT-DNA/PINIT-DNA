/**
 * Enterprise DNA Package storage — Milestone B Step 2.
 */
import {
  assembleEnterpriseDnaPackage,
  buildEnterpriseDnaLayer,
  computeIntegrityMerkleRoot,
  computeLayerIntegrityHash,
  computeOverallFingerprintHash,
  computeOverallIntegrityHash,
  ENTERPRISE_DNA_PACKAGE_KEY,
  mergeUniversalFingerprintsImmutable,
  validateEnterpriseDnaPackage,
} from '../../src/services/dna/enterprise-dna-package.service';
import { DNA_INTEGRITY_VERSION, DNA_PACKAGE_VERSION } from '../../src/config/dna-versions';

describe('enterprise-dna-package (Milestone B Step 2)', () => {
  function makeFifteenLayers(fingerprintPrefix = 'fp'): ReturnType<typeof buildEnterpriseDnaLayer>[] {
    return Array.from({ length: 15 }, (_, i) => {
      const n = i + 1;
      return buildEnterpriseDnaLayer({
        layerNumber: n,
        fingerprint: `${fingerprintPrefix}${n.toString().padStart(2, '0')}${'a'.repeat(60)}`.slice(0, 64),
        fingerprintAlgorithm: `L${n}-algo`,
        present: true,
        deterministic: n <= 10,
        generationDurationMs: n,
      });
    });
  }

  it('builds a complete package with 15 layers and integrity hashes', () => {
    const layers = makeFifteenLayers();
    const pkg = assembleEnterpriseDnaPackage({
      dnaId: 'dna-1',
      ownerId: 'owner-1',
      assetId: 'vault-1',
      mediaType: 'IMAGE',
      contentId: 'c'.repeat(64),
      creationTime: '2026-01-01T00:00:00.000Z',
      layers,
    });

    expect(pkg.schema).toBe('enterprise-dna-package-v1');
    expect(pkg.dnaPackageVersion).toBe(DNA_PACKAGE_VERSION);
    expect(pkg.integrityVersion).toBe(DNA_INTEGRITY_VERSION);
    expect(pkg.layers).toHaveLength(15);
    expect(pkg.overallIntegrityHash).toMatch(/^[a-f0-9]{64}$/);
    expect(pkg.overallFingerprintHash).toMatch(/^[a-f0-9]{64}$/);
    expect(pkg.integrityMerkleRoot).toMatch(/^[a-f0-9]{64}$/);
    expect(pkg.storageStatus).toBe('SEALED');
    expect(pkg.generationStatus).toBe('COMPLETE');
    expect(pkg.validationStatus).toBe('VALID');

    for (const layer of pkg.layers) {
      expect(layer.fingerprintSize).toBe(layer.fingerprint.length);
      expect(layer.integrityHash).toMatch(/^[a-f0-9]{64}$/);
      expect(layer.storageStatus).toBe('SEALED');
      expect(layer.validationStatus).toBe('VALID');
    }
  });

  it('marks PARTIAL when layers are missing', () => {
    const layers = makeFifteenLayers().slice(0, 10);
    const pkg = assembleEnterpriseDnaPackage({
      dnaId: 'dna-2',
      ownerId: null,
      assetId: null,
      mediaType: 'PDF',
      contentId: 'd'.repeat(64),
      creationTime: '2026-01-01T00:00:00.000Z',
      layers,
    });
    expect(pkg.layers).toHaveLength(15);
    expect(pkg.generationStatus).toBe('PARTIAL');
    expect(pkg.validationStatus).toBe('INVALID');
  });

  it('integrity hashes are stable for identical inputs', () => {
    const a = computeLayerIntegrityHash({
      layerNumber: 1,
      fingerprint: 'abc',
      fingerprintAlgorithm: 'L1',
      fingerprintVersion: '15-layer-v1',
      deterministic: true,
    });
    const b = computeLayerIntegrityHash({
      layerNumber: 1,
      fingerprint: 'abc',
      fingerprintAlgorithm: 'L1',
      fingerprintVersion: '15-layer-v1',
      deterministic: true,
    });
    expect(a).toBe(b);

    const fps = ['a', 'b', 'c'];
    expect(computeOverallFingerprintHash(fps)).toBe(computeOverallFingerprintHash(fps));
    expect(computeIntegrityMerkleRoot(fps)).toBe(computeIntegrityMerkleRoot(fps));
  });

  it('overall integrity changes when a layer fingerprint changes', () => {
    const layers1 = makeFifteenLayers('aa');
    const layers2 = makeFifteenLayers('bb');
    const p1 = assembleEnterpriseDnaPackage({
      dnaId: 'dna-x',
      ownerId: null,
      assetId: null,
      mediaType: 'IMAGE',
      contentId: 'e'.repeat(64),
      creationTime: '2026-01-01T00:00:00.000Z',
      layers: layers1,
    });
    const p2 = assembleEnterpriseDnaPackage({
      dnaId: 'dna-x',
      ownerId: null,
      assetId: null,
      mediaType: 'IMAGE',
      contentId: 'e'.repeat(64),
      creationTime: '2026-01-01T00:00:00.000Z',
      layers: layers2,
    });
    expect(p1.overallFingerprintHash).not.toBe(p2.overallFingerprintHash);
    expect(p1.overallIntegrityHash).not.toBe(p2.overallIntegrityHash);
  });

  it('refuses overwrite of sealed enterpriseDnaPackage', () => {
    const layers = makeFifteenLayers();
    const pkg = assembleEnterpriseDnaPackage({
      dnaId: 'dna-seal',
      ownerId: null,
      assetId: null,
      mediaType: 'IMAGE',
      contentId: 'f'.repeat(64),
      creationTime: '2026-01-01T00:00:00.000Z',
      layers,
    });
    expect(pkg.storageStatus).toBe('SEALED');

    const existing = { [ENTERPRISE_DNA_PACKAGE_KEY]: pkg, selfLearning: [] };
    const mutated = {
      ...pkg,
      layers: pkg.layers.map((l) => ({ ...l, fingerprint: 'MUTATED' + l.fingerprint.slice(7) })),
    };
    const merged = mergeUniversalFingerprintsImmutable(existing, {
      [ENTERPRISE_DNA_PACKAGE_KEY]: mutated,
      selfLearning: [{ note: 'ok' }],
    });

    expect((merged[ENTERPRISE_DNA_PACKAGE_KEY] as typeof pkg).layers[0]!.fingerprint).toBe(
      pkg.layers[0]!.fingerprint,
    );
    expect(merged.selfLearning).toEqual([{ note: 'ok' }]);
  });

  it('validateEnterpriseDnaPackage reports completeness', () => {
    const layers = makeFifteenLayers();
    const pkg = assembleEnterpriseDnaPackage({
      dnaId: 'dna-v',
      ownerId: null,
      assetId: null,
      mediaType: 'AUDIO',
      contentId: 'g'.repeat(64),
      creationTime: '2026-01-01T00:00:00.000Z',
      layers,
    });
    const v = validateEnterpriseDnaPackage(pkg);
    expect(v.ok).toBe(true);
    expect(v.generationStatus).toBe('COMPLETE');
  });

  it('computeOverallIntegrityHash is deterministic', () => {
    const args = {
      dnaId: 'id',
      contentId: 'cid',
      mediaType: 'IMAGE',
      dnaSchemaVersion: '1.0.0',
      dnaAlgorithmVersion: '15-layer-v1',
      fingerprintVersion: '15-layer-v1',
      generatorVersion: '2.0.0-universal',
      integrityVersion: DNA_INTEGRITY_VERSION,
      dnaPackageVersion: DNA_PACKAGE_VERSION,
      integrityMerkleRoot: 'm'.repeat(64),
      layerIntegrityHashes: ['a'.repeat(64), 'b'.repeat(64)],
    };
    expect(computeOverallIntegrityHash(args)).toBe(computeOverallIntegrityHash(args));
  });
});
