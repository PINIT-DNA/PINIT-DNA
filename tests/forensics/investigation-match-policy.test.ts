/**
 * Investigation match policy — 50 / 55 / 70 / 75 / 90 table (acceptance-policy-v1.2).
 */
import {
  DERIVATIVE_PROMOTE_L3_MIN,
  DNA_PARTIAL_MIN,
  getInvestigationVaultDnaSourcePreference,
  INVESTIGATION_MATCH_POLICY,
  INVESTIGATION_PREFER_LIVE_VAULT_FP,
  LIKELY_OWNER_MIN,
  LOCAL_PATCH_RESCUE_MIN,
  NOT_FOUND_MAX_WITHOUT_PATCH,
  POSSIBLE_L3_MIN_WITHOUT_PATCH,
  POSSIBLE_MIN,
  PREFER_STORED_VAULT_DNA,
  VERIFIED_FUSION_MIN,
} from '../../src/config/investigation-match-policy';
import { ACCEPTANCE_POLICY_VERSION } from '../../src/types/acceptance.types';
import { DNA_ACCEPTANCE_VERSION } from '../../src/config/dna-versions';

describe('investigation-match-policy', () => {
  const originalPreferStored = process.env.PREFER_STORED_VAULT_DNA;

  afterEach(() => {
    if (originalPreferStored === undefined) {
      delete process.env.PREFER_STORED_VAULT_DNA;
    } else {
      process.env.PREFER_STORED_VAULT_DNA = originalPreferStored;
    }
    jest.resetModules();
  });

  it('exports the locked product threshold table', () => {
    expect(NOT_FOUND_MAX_WITHOUT_PATCH).toBe(50);
    expect(POSSIBLE_MIN).toBe(55);
    expect(POSSIBLE_L3_MIN_WITHOUT_PATCH).toBe(70);
    expect(LOCAL_PATCH_RESCUE_MIN).toBe(55);
    expect(DERIVATIVE_PROMOTE_L3_MIN).toBe(75);
    expect(VERIFIED_FUSION_MIN).toBe(90);
    expect(LIKELY_OWNER_MIN).toBe(75);
    expect(DNA_PARTIAL_MIN).toBe(50);
    expect(INVESTIGATION_PREFER_LIVE_VAULT_FP).toBe(true);
    expect(PREFER_STORED_VAULT_DNA).toBe(true);
    expect(INVESTIGATION_MATCH_POLICY.preferLiveVaultFingerprint).toBe(true);
    expect(INVESTIGATION_MATCH_POLICY.preferStoredVaultDna).toBe(true);
  });

  it('defaults PREFER_STORED_VAULT_DNA to true (Milestone C SSoT)', () => {
    delete process.env.PREFER_STORED_VAULT_DNA;
    delete process.env.USE_STORED_DNA_PRIMARY;
    jest.isolateModules(() => {
      const policy = require('../../src/config/investigation-match-policy');
      expect(policy.PREFER_STORED_VAULT_DNA).toBe(true);
      expect(policy.INVESTIGATION_PREFER_LIVE_VAULT_FP).toBe(true);
    });
  });

  it('documents Milestone C preference: stored package primary, live FP fallback', () => {
    const pref = getInvestigationVaultDnaSourcePreference();
    expect(pref.preferLiveVaultFingerprint).toBe(true);
    expect(pref.preferStoredVaultDna).toBe(true);
    expect(pref.migrationNote).toContain('enterpriseDnaPackage');
  });

  it('uses acceptance-policy-v1.2', () => {
    expect(ACCEPTANCE_POLICY_VERSION).toBe(DNA_ACCEPTANCE_VERSION);
    expect(ACCEPTANCE_POLICY_VERSION).toBe('acceptance-policy-v1.2');
  });
});
