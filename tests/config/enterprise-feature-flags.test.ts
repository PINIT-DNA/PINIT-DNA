/**
 * Enterprise Feature Flag Framework — Task A2 (behaviour-neutral).
 */
import {
  ALL_ENTERPRISE_FEATURE_FLAGS,
  ENTERPRISE_FEATURE_FLAG,
  ENTERPRISE_FEATURE_FLAG_REGISTRY,
  FEATURE_FLAG_CATEGORY,
  getEnterpriseFeatureFlag,
  getEnterpriseFeatureFlagsByCategory,
  isEnterpriseFeatureEnabled,
  listEnterpriseFeatureFlags,
  parseFeatureFlagEnv,
} from '../../src/config/enterprise-feature-flags';
import { PREFER_STORED_VAULT_DNA } from '../../src/config/investigation-match-policy';

describe('enterprise-feature-flags (Task A2)', () => {
  const envKeysTouched: string[] = [];

  function setEnv(key: string, value: string | undefined) {
    envKeysTouched.push(key);
    if (value === undefined) delete process.env[key];
    else process.env[key] = value;
  }

  afterEach(() => {
    for (const key of envKeysTouched) delete process.env[key];
    envKeysTouched.length = 0;
    jest.resetModules();
  });

  it('registers every Task A2 flag exactly once', () => {
    const expected = Object.values(ENTERPRISE_FEATURE_FLAG);
    expect(ALL_ENTERPRISE_FEATURE_FLAGS).toHaveLength(expected.length);
    expect(new Set(ALL_ENTERPRISE_FEATURE_FLAGS).size).toBe(expected.length);
    for (const name of expected) {
      expect(ENTERPRISE_FEATURE_FLAG_REGISTRY[name].name).toBe(name);
    }
  });

  it('requires name, description, default, version, category, documentation, envKey', () => {
    for (const name of ALL_ENTERPRISE_FEATURE_FLAGS) {
      const def = ENTERPRISE_FEATURE_FLAG_REGISTRY[name];
      expect(def.name).toBe(name);
      expect(def.description.length).toBeGreaterThan(0);
      expect(typeof def.defaultValue).toBe('boolean');
      expect(def.versionIntroduced).toBe('A2');
      expect(Object.values(FEATURE_FLAG_CATEGORY)).toContain(def.category);
      expect(def.documentation.length).toBeGreaterThan(0);
      expect(def.envKey).toBe(name);
    }
  });

  it('defaults preserve current behaviour (V2 OFF except Milestone D/E retrieval+comparison ON; B1/B2 DNA storage ON)', () => {
    expect(ENTERPRISE_FEATURE_FLAG_REGISTRY.DNA_V2_ENABLED.defaultValue).toBe(false);
    expect(ENTERPRISE_FEATURE_FLAG_REGISTRY.DNA_DETERMINISTIC_MODE.defaultValue).toBe(true);
    expect(ENTERPRISE_FEATURE_FLAG_REGISTRY.DNA_IMMUTABLE_STORAGE.defaultValue).toBe(true);
    expect(ENTERPRISE_FEATURE_FLAG_REGISTRY.DNA_INTEGRITY_HASH.defaultValue).toBe(true);
    expect(ENTERPRISE_FEATURE_FLAG_REGISTRY.DNA_VERSIONING.defaultValue).toBe(true);
    expect(ENTERPRISE_FEATURE_FLAG_REGISTRY.COMPARISON_V2.defaultValue).toBe(true);
    expect(ENTERPRISE_FEATURE_FLAG_REGISTRY.ACCEPTANCE_V2.defaultValue).toBe(true);
    expect(ENTERPRISE_FEATURE_FLAG_REGISTRY.INVESTIGATION_V2.defaultValue).toBe(false);
    expect(ENTERPRISE_FEATURE_FLAG_REGISTRY.RECALL_ENGINE_V2.defaultValue).toBe(true);
    expect(ENTERPRISE_FEATURE_FLAG_REGISTRY.ANN_RETRIEVAL.defaultValue).toBe(false);
    expect(ENTERPRISE_FEATURE_FLAG_REGISTRY.VISUAL_RETRIEVAL_V2.defaultValue).toBe(true);
    expect(ENTERPRISE_FEATURE_FLAG_REGISTRY.USE_STORED_DNA_PRIMARY.defaultValue).toBe(true);
    expect(ENTERPRISE_FEATURE_FLAG_REGISTRY.AUTHORITATIVE_STORED_DNA.defaultValue).toBe(true);
    expect(ENTERPRISE_FEATURE_FLAG_REGISTRY.ENABLE_LAYER11_COMPARE.defaultValue).toBe(true);
    expect(ENTERPRISE_FEATURE_FLAG_REGISTRY.ENABLE_LAYER15_COMPARE.defaultValue).toBe(true);
    expect(ENTERPRISE_FEATURE_FLAG_REGISTRY.PATCH_DNA_ENGINE.defaultValue).toBe(true);
    expect(ENTERPRISE_FEATURE_FLAG_REGISTRY.IDENTITY_SHORTCUTS.defaultValue).toBe(true);
  });

  it('resolves defaults when env unset', () => {
    expect(isEnterpriseFeatureEnabled('USE_STORED_DNA_PRIMARY')).toBe(true);
    expect(isEnterpriseFeatureEnabled('AUTHORITATIVE_STORED_DNA')).toBe(true);
    expect(isEnterpriseFeatureEnabled('PATCH_DNA_ENGINE')).toBe(true);
    expect(isEnterpriseFeatureEnabled('COMPARISON_V2')).toBe(true);
  });

  it('honours env overrides', () => {
    setEnv('COMPARISON_V2', 'true');
    jest.isolateModules(() => {
      const mod = require('../../src/config/enterprise-feature-flags');
      expect(mod.isEnterpriseFeatureEnabled('COMPARISON_V2')).toBe(true);
    });
  });

  it('accepts legacy PREFER_STORED_VAULT_DNA env for USE_STORED_DNA_PRIMARY', () => {
    setEnv('PREFER_STORED_VAULT_DNA', '0');
    jest.isolateModules(() => {
      const mod = require('../../src/config/enterprise-feature-flags');
      expect(mod.isEnterpriseFeatureEnabled('USE_STORED_DNA_PRIMARY')).toBe(false);
    });
  });

  it('aliases PREFER_STORED_VAULT_DNA to USE_STORED_DNA_PRIMARY (default true)', () => {
    expect(PREFER_STORED_VAULT_DNA).toBe(true);
    expect(PREFER_STORED_VAULT_DNA).toBe(isEnterpriseFeatureEnabled('USE_STORED_DNA_PRIMARY'));
  });

  it('groups flags by category', () => {
    expect(getEnterpriseFeatureFlagsByCategory(FEATURE_FLAG_CATEGORY.DNA_GENERATION)).toHaveLength(5);
    expect(getEnterpriseFeatureFlagsByCategory(FEATURE_FLAG_CATEGORY.RETRIEVAL)).toHaveLength(5);
    expect(getEnterpriseFeatureFlagsByCategory(FEATURE_FLAG_CATEGORY.COMPARISON)).toHaveLength(8);
    expect(getEnterpriseFeatureFlagsByCategory(FEATURE_FLAG_CATEGORY.ACCEPTANCE)).toHaveLength(4);
    expect(getEnterpriseFeatureFlagsByCategory(FEATURE_FLAG_CATEGORY.INVESTIGATION)).toHaveLength(5);
    expect(getEnterpriseFeatureFlagsByCategory(FEATURE_FLAG_CATEGORY.PERFORMANCE)).toHaveLength(4);
  });

  it('lists flags with documentation fields', () => {
    const list = listEnterpriseFeatureFlags();
    expect(list.length).toBe(ALL_ENTERPRISE_FEATURE_FLAGS.length);
    expect(getEnterpriseFeatureFlag('DNA_V2_ENABLED').definition.documentation).toContain('Milestone');
  });

  it('parseFeatureFlagEnv matches documented truthy/falsy set', () => {
    expect(parseFeatureFlagEnv(undefined, false)).toBe(false);
    expect(parseFeatureFlagEnv('yes', false)).toBe(true);
    expect(parseFeatureFlagEnv('off', true)).toBe(false);
    expect(parseFeatureFlagEnv('maybe', true)).toBe(true);
  });
});
