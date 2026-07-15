/**
 * Investigation match policy — 50 / 55 / 70 / 75 / 90 table (acceptance-policy-v1.2).
 */
import {
  DERIVATIVE_PROMOTE_L3_MIN,
  DNA_PARTIAL_MIN,
  INVESTIGATION_MATCH_POLICY,
  LIKELY_OWNER_MIN,
  LOCAL_PATCH_RESCUE_MIN,
  NOT_FOUND_MAX_WITHOUT_PATCH,
  POSSIBLE_L3_MIN_WITHOUT_PATCH,
  POSSIBLE_MIN,
  VERIFIED_FUSION_MIN,
} from '../../src/config/investigation-match-policy';
import { ACCEPTANCE_POLICY_VERSION } from '../../src/types/acceptance.types';

describe('investigation-match-policy', () => {
  it('exports the locked product threshold table', () => {
    expect(NOT_FOUND_MAX_WITHOUT_PATCH).toBe(50);
    expect(POSSIBLE_MIN).toBe(55);
    expect(POSSIBLE_L3_MIN_WITHOUT_PATCH).toBe(70);
    expect(LOCAL_PATCH_RESCUE_MIN).toBe(55);
    expect(DERIVATIVE_PROMOTE_L3_MIN).toBe(75);
    expect(VERIFIED_FUSION_MIN).toBe(90);
    expect(LIKELY_OWNER_MIN).toBe(75);
    expect(DNA_PARTIAL_MIN).toBe(50);
    expect(INVESTIGATION_MATCH_POLICY.preferLiveVaultFingerprint).toBe(true);
  });

  it('uses acceptance-policy-v1.2', () => {
    expect(ACCEPTANCE_POLICY_VERSION).toBe('acceptance-policy-v1.2');
  });
});
