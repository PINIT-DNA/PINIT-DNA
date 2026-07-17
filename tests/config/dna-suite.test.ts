/**
 * Enterprise DNA suite contracts — Milestone A (behavior-neutral).
 * @see docs/PHASE10_ENTERPRISE_DNA_SPECIFICATION.md
 */
import {
  DNA_ENGINE_ROLE,
  DNA_MODULE_IDS,
  DNA_MODULE_REGISTRY_EDS,
  DNA_MODULES_BY_ENGINE,
  DNA_SUITE_POLICY_BUNDLE,
  DNA_SUITE_VERSION,
  getDnaModuleEngineRole,
  isEvidenceDnaModule,
  isIdentityDnaModule,
  isOwnershipDnaModule,
} from '../../src/config/dna-suite';

describe('dna-suite contracts (Milestone A)', () => {
  it('exports frozen suite version ids', () => {
    expect(DNA_SUITE_VERSION).toBe('eds-1.0');
    expect(DNA_SUITE_POLICY_BUNDLE).toBe('dna-suite-eds-1.0');
  });

  it('defines exactly 15 EDS modules L1–L15', () => {
    expect(DNA_MODULE_IDS).toHaveLength(15);
    expect(DNA_MODULE_REGISTRY_EDS).toHaveLength(15);
    expect(DNA_MODULE_REGISTRY_EDS.map((m) => m.id)).toEqual([...DNA_MODULE_IDS]);
  });

  it('assigns modules to Identity / Ownership / Evidence per EDS', () => {
    expect(DNA_MODULES_BY_ENGINE[DNA_ENGINE_ROLE.IDENTITY]).toEqual([1, 2, 3, 4, 5, 6, 7, 8, 9, 10]);
    expect(DNA_MODULES_BY_ENGINE[DNA_ENGINE_ROLE.OWNERSHIP]).toEqual([12, 14, 15]);
    expect(DNA_MODULES_BY_ENGINE[DNA_ENGINE_ROLE.EVIDENCE]).toEqual([11, 13]);
  });

  it('classifies modules via helpers', () => {
    expect(isIdentityDnaModule(1)).toBe(true);
    expect(isIdentityDnaModule(10)).toBe(true);
    expect(isIdentityDnaModule(11)).toBe(false);

    expect(isOwnershipDnaModule(12)).toBe(true);
    expect(isOwnershipDnaModule(15)).toBe(true);
    expect(isOwnershipDnaModule(13)).toBe(false);

    expect(isEvidenceDnaModule(11)).toBe(true);
    expect(isEvidenceDnaModule(13)).toBe(true);
    expect(isEvidenceDnaModule(12)).toBe(false);
  });

  it('returns undefined for invalid module ids', () => {
    expect(getDnaModuleEngineRole(0)).toBeUndefined();
    expect(getDnaModuleEngineRole(16)).toBeUndefined();
  });

  it('does not assign ACCEPTANCE role to any DNA module slot', () => {
    for (const mod of DNA_MODULE_REGISTRY_EDS) {
      expect(mod.engineRole).not.toBe(DNA_ENGINE_ROLE.ACCEPTANCE);
    }
  });
});
