/**
 * Global version contracts — Task A1 (behaviour-neutral).
 * Locks Phase 10 Part 7 identifiers to today's production string values.
 */
import {
  DNA_ACCEPTANCE_VERSION,
  DNA_ALGORITHM_VERSION,
  DNA_COMPARISON_VERSION,
  DNA_FINGERPRINT_VERSION,
  DNA_GENERATOR_VERSION,
  DNA_SCHEMA_VERSION,
  DNA_STORAGE_VERSION,
  DNA_VERSION_CONTRACT,
  INVESTIGATION_ENGINE_VERSION,
  REPORT_VERSION,
  SYSTEM_VERSION,
} from '../../src/config/dna-versions';
import {
  ACCEPTANCE_POLICY_VERSION,
  DNA_ALGORITHM_VERSION as ALG_FROM_ACCEPTANCE,
} from '../../src/types/acceptance.types';
import { INVESTIGATION_MANIFEST_VERSION } from '../../src/types/investigation-manifest.types';

describe('dna-versions contracts (Task A1)', () => {
  it('exports the frozen Phase 10 version tuple with legacy-compatible values', () => {
    expect(SYSTEM_VERSION).toBe('1.0.0');
    expect(DNA_SCHEMA_VERSION).toBe('1.0.0');
    expect(DNA_ALGORITHM_VERSION).toBe('15-layer-v1');
    expect(DNA_FINGERPRINT_VERSION).toBe('15-layer-v1');
    expect(DNA_GENERATOR_VERSION).toBe('2.0.0-universal');
    expect(DNA_COMPARISON_VERSION).toBe('2.0.0-universal');
    expect(DNA_ACCEPTANCE_VERSION).toBe('acceptance-policy-v1.2');
    expect(DNA_STORAGE_VERSION).toBe('1.0.0');
    expect(INVESTIGATION_ENGINE_VERSION).toBe('1.0.0');
    expect(REPORT_VERSION).toBe('investigation-manifest-v1.0');
  });

  it('exposes DNA_VERSION_CONTRACT including integrity + package versions', () => {
    expect(Object.keys(DNA_VERSION_CONTRACT).sort()).toEqual(
      [
        'DNA_ACCEPTANCE_VERSION',
        'DNA_ALGORITHM_VERSION',
        'DNA_COMPARISON_VERSION',
        'DNA_FINGERPRINT_VERSION',
        'DNA_GENERATOR_VERSION',
        'DNA_INTEGRITY_VERSION',
        'DNA_PACKAGE_VERSION',
        'DNA_SCHEMA_VERSION',
        'DNA_STORAGE_VERSION',
        'INVESTIGATION_ENGINE_VERSION',
        'REPORT_VERSION',
        'SYSTEM_VERSION',
      ].sort(),
    );
  });

  it('keeps legacy aliases byte-identical to the central constants', () => {
    expect(ACCEPTANCE_POLICY_VERSION).toBe(DNA_ACCEPTANCE_VERSION);
    expect(ALG_FROM_ACCEPTANCE).toBe(DNA_ALGORITHM_VERSION);
    expect(INVESTIGATION_MANIFEST_VERSION).toBe(REPORT_VERSION);
  });
});
