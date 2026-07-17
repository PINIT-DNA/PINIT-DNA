/**
 * Milestone C — Investigation reads enterpriseDnaPackage as SSoT.
 */
import {
  assembleEnterpriseDnaPackage,
  buildEnterpriseDnaLayer,
  ENTERPRISE_DNA_PACKAGE_KEY,
} from '../../src/services/dna/enterprise-dna-package.service';
import {
  enterprisePackageToEphemeralFingerprint,
  isEnterprisePackageUsableForInvestigation,
  resolveInvestigationVaultDnaSource,
} from '../../src/services/forensics/investigation-stored-dna-source.service';

jest.mock('../../src/lib/prisma', () => ({
  prisma: {
    dnaRecord: {
      findUnique: jest.fn(),
    },
  },
}));

import { prisma } from '../../src/lib/prisma';

const findUnique = prisma.dnaRecord.findUnique as jest.Mock;

function makeFifteenLayers(prefix = 'fp') {
  return Array.from({ length: 15 }, (_, i) => {
    const n = i + 1;
    return buildEnterpriseDnaLayer({
      layerNumber: n,
      fingerprint: `${prefix}${n.toString().padStart(2, '0')}${'a'.repeat(60)}`.slice(0, 64),
      fingerprintAlgorithm: `L${n}-algo`,
      present: true,
      deterministic: n <= 10,
      generationDurationMs: n,
    });
  });
}

function makeValidPackage() {
  return assembleEnterpriseDnaPackage({
    dnaId: 'dna-test-1',
    ownerId: 'owner-1',
    assetId: 'vault-1',
    mediaType: 'IMAGE',
    contentId: 'c'.repeat(64),
    creationTime: '2026-01-01T00:00:00.000Z',
    layers: makeFifteenLayers(),
  });
}

describe('investigation-stored-dna-source (Milestone C)', () => {
  const envTouched: string[] = [];

  function setEnv(key: string, value: string | undefined) {
    envTouched.push(key);
    if (value === undefined) delete process.env[key];
    else process.env[key] = value;
  }

  afterEach(() => {
    for (const key of envTouched) delete process.env[key];
    envTouched.length = 0;
    findUnique.mockReset();
    jest.resetModules();
  });

  it('accepts a complete package with valid integrity', () => {
    const pkg = makeValidPackage();
    const check = isEnterprisePackageUsableForInvestigation(pkg);
    expect(check.ok).toBe(true);
    expect(check.integrityValid).toBe(true);
    expect(check.reason).toBe('enterprise_package_valid');
  });

  it('rejects corrupted integrity hash', () => {
    const pkg = makeValidPackage();
    pkg.overallIntegrityHash = '0'.repeat(64);
    const check = isEnterprisePackageUsableForInvestigation(pkg);
    expect(check.ok).toBe(false);
    expect(check.reason).toBe('integrity_hash_mismatch');
    expect(check.integrityValid).toBe(false);
  });

  it('rejects incomplete layer count', () => {
    const pkg = makeValidPackage();
    pkg.layers = pkg.layers.slice(0, 10);
    const check = isEnterprisePackageUsableForInvestigation(pkg);
    expect(check.ok).toBe(false);
    expect(check.reason).toContain('layer_count_');
  });

  it('maps package layers to EphemeralFingerprint without regenerating', () => {
    const pkg = makeValidPackage();
    const fp = enterprisePackageToEphemeralFingerprint(pkg, {
      filename: 'vault.png',
      mimeType: 'image/png',
      sizeBytes: 1234,
    });
    expect(fp.detectedBy).toBe('enterprise-dna-package');
    expect(fp.layers).toHaveLength(15);
    expect(fp.layers[0]!.fingerprint).toBe(pkg.layers[0]!.fingerprint);
    expect(fp.layers[0]!.data).toMatchObject({ source: 'enterprise_dna_package' });
  });

  it('valid package → enterprise_package mode', async () => {
    const pkg = makeValidPackage();
    findUnique.mockResolvedValue({
      id: 'dna-test-1',
      imageFilename: 'vault.png',
      imageMimeType: 'image/png',
      imageSizeBytes: 100,
      universalFingerprints: { [ENTERPRISE_DNA_PACKAGE_KEY]: pkg },
    });

    const resolved = await resolveInvestigationVaultDnaSource('dna-test-1');
    expect(resolved.mode).toBe('enterprise_package');
    expect(resolved.packagePresent).toBe(true);
    expect(resolved.integrityValid).toBe(true);
    expect(resolved.fingerprint?.layers).toHaveLength(15);
  });

  it('missing package → legacy fallback', async () => {
    findUnique.mockResolvedValue({
      id: 'dna-old',
      imageFilename: 'old.png',
      imageMimeType: 'image/png',
      imageSizeBytes: 50,
      universalFingerprints: { selfLearning: [] },
    });

    const resolved = await resolveInvestigationVaultDnaSource('dna-old');
    expect(resolved.mode).toBe('legacy_live');
    expect(resolved.reason).toBe('missing_enterprise_package');
    expect(resolved.packagePresent).toBe(false);
    expect(resolved.fingerprint).toBeUndefined();
  });

  it('corrupted package → legacy fallback', async () => {
    const pkg = makeValidPackage();
    pkg.overallIntegrityHash = 'f'.repeat(64);
    findUnique.mockResolvedValue({
      id: 'dna-bad',
      imageFilename: 'bad.png',
      imageMimeType: 'image/png',
      imageSizeBytes: 50,
      universalFingerprints: { [ENTERPRISE_DNA_PACKAGE_KEY]: pkg },
    });

    const resolved = await resolveInvestigationVaultDnaSource('dna-bad');
    expect(resolved.mode).toBe('legacy_live');
    expect(resolved.reason).toBe('integrity_hash_mismatch');
    expect(resolved.packagePresent).toBe(true);
    expect(resolved.fingerprint).toBeUndefined();
  });

  it('flag off → fallback regeneration path', async () => {
    setEnv('USE_STORED_DNA_PRIMARY', 'false');
    setEnv('AUTHORITATIVE_STORED_DNA', 'false');
    setEnv('PREFER_STORED_VAULT_DNA', 'false');

    await jest.isolateModulesAsync(async () => {
      const { resolveInvestigationVaultDnaSource: resolve } = require(
        '../../src/services/forensics/investigation-stored-dna-source.service',
      );
      const resolved = await resolve('dna-any');
      expect(resolved.mode).toBe('legacy_live');
      expect(resolved.reason).toBe('feature_flag_off');
      expect(findUnique).not.toHaveBeenCalled();
    });
  });
});
