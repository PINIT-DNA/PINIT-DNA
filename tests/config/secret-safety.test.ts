/**
 * checkProductionSecretSafety() — the app used to silently fall back to a
 * hardcoded, public default value when a secret was unset in production
 * (found for real: JWT_SECRET was unset live, so every login was signed
 * with a secret visible on GitHub). This makes that failure LOUD instead of
 * silent, without hard-crashing the process by default — a wrongly-timed
 * hard-fail here is its own kind of outage.
 */
import { describe, test, expect, jest, beforeEach, afterEach } from '@jest/globals';

type AnyFn = (...args: unknown[]) => unknown;

jest.mock('../../src/lib/logger', () => ({
  logger: { warn: jest.fn(), info: jest.fn(), error: jest.fn(), debug: jest.fn() },
}));

// config/index.ts calls dotenv.config() on every fresh import, which
// re-reads the REAL .env file and silently refills any key a test deletes
// (e.g. JWT_SECRET is genuinely fixed there now) — that would make "unset"
// tests below pass for the wrong reason (or fail, as it did before this was
// added). Mock it out so process.env manipulation in this file is the only
// source of truth during these tests.
jest.mock('dotenv', () => ({ config: jest.fn() }));

// config/index.ts ALSO does its own raw fs.readFileSync('.env') specifically
// to force EXCHANGE_BRIDGE_SECRET from the file — separate from dotenv, and
// not gated by "only if unset." Left alone, that would silently overwrite
// whatever this test sets. Neutralize only the .env read; every other fs
// call in the require chain keeps its real behavior.
jest.mock('fs', () => {
  const real = jest.requireActual('fs') as typeof import('fs');
  return {
    ...real,
    existsSync: (p: unknown) => (typeof p === 'string' && p.endsWith('.env') ? false : real.existsSync(p as never)),
  };
});

const touchedKeys = new Set<string>([
  'NODE_ENV', 'FAIL_ON_INSECURE_SECRETS', 'JWT_SECRET', 'VAULT_MASTER_SECRET',
  'LSB_SIGNATURE_SECRET', 'EXCHANGE_BRIDGE_SECRET', 'SPATIAL_AUTH_SECRET',
  'DNA_VNEXT_SECRET', 'BLOCK_DNA_SECRET', 'SHARE_HMAC_SECRET', 'DATABASE_URL',
]);
const savedEnv: Record<string, string | undefined> = {};

beforeEach(() => {
  for (const k of touchedKeys) savedEnv[k] = process.env[k];
  // dotenv is mocked to a no-op above, so config/index.ts's required('DATABASE_URL')
  // needs this set directly — it would otherwise only ever come from a real .env read.
  process.env['DATABASE_URL'] = 'postgresql://test:test@localhost:5432/test';
});

afterEach(() => {
  for (const k of touchedKeys) {
    if (savedEnv[k] === undefined) delete process.env[k];
    else process.env[k] = savedEnv[k];
  }
  jest.resetModules();
});

/** Fresh re-import so config/index.ts and dna-vnext.ts re-resolve process.env. */
function loadFresh(): { checkProductionSecretSafety: () => void; logger: { error: AnyFn; info: AnyFn } } {
  jest.resetModules();
  // eslint-disable-next-line @typescript-eslint/no-var-requires
  const { checkProductionSecretSafety } = require('../../src/config/secret-safety');
  // eslint-disable-next-line @typescript-eslint/no-var-requires
  const { logger } = require('../../src/lib/logger');
  return { checkProductionSecretSafety, logger };
}

function setSecureBaseline() {
  process.env['JWT_SECRET'] = 'a-real-random-jwt-secret-not-the-default-value';
  process.env['VAULT_MASTER_SECRET'] = 'a-real-random-vault-secret-not-the-default';
  process.env['LSB_SIGNATURE_SECRET'] = 'a-real-random-lsb-secret-not-the-default';
  process.env['EXCHANGE_BRIDGE_SECRET'] = 'a-real-random-bridge-secret';
  process.env['SPATIAL_AUTH_SECRET'] = 'a-real-random-spatial-secret';
  process.env['SHARE_HMAC_SECRET'] = 'a-real-random-share-hmac-secret';
}

describe('checkProductionSecretSafety', () => {
  test('does nothing outside production — even with every secret at its default', () => {
    process.env['NODE_ENV'] = 'development';
    delete process.env['JWT_SECRET'];
    delete process.env['VAULT_MASTER_SECRET'];

    const { checkProductionSecretSafety, logger } = loadFresh();
    expect(() => checkProductionSecretSafety()).not.toThrow();
    expect(logger.error).not.toHaveBeenCalled();
  });

  test('production, all secrets real — logs a clean info line, no errors, no throw', () => {
    process.env['NODE_ENV'] = 'production';
    setSecureBaseline();

    const { checkProductionSecretSafety, logger } = loadFresh();
    expect(() => checkProductionSecretSafety()).not.toThrow();
    expect(logger.error).not.toHaveBeenCalled();
    expect(logger.info).toHaveBeenCalledWith(expect.stringContaining('no known public defaults'));
  });

  test('production, JWT_SECRET unset — logs loudly but does NOT crash by default (the real bug this was built for)', () => {
    process.env['NODE_ENV'] = 'production';
    setSecureBaseline();
    delete process.env['JWT_SECRET'];
    delete process.env['FAIL_ON_INSECURE_SECRETS'];

    const { checkProductionSecretSafety, logger } = loadFresh();
    expect(() => checkProductionSecretSafety()).not.toThrow();
    expect(logger.error).toHaveBeenCalledWith(
      expect.stringContaining('JWT_SECRET is INSECURE in production'),
    );
  });

  test('production, JWT_SECRET unset, FAIL_ON_INSECURE_SECRETS=true — refuses to start', () => {
    process.env['NODE_ENV'] = 'production';
    setSecureBaseline();
    delete process.env['JWT_SECRET'];
    process.env['FAIL_ON_INSECURE_SECRETS'] = 'true';

    const { checkProductionSecretSafety } = loadFresh();
    expect(() => checkProductionSecretSafety()).toThrow(/Refusing to start/);
  });

  test('EXCHANGE_BRIDGE_SECRET unset is flagged even though its fallback silently resolves to a real value', () => {
    // Chained fallback -> JWT_SECRET. Once JWT_SECRET is a real secret, the
    // RESOLVED value of config.exchange.bridgeSecret looks fine — this is
    // exactly the case that would otherwise hide a real gap. The check must
    // look at whether EXCHANGE_BRIDGE_SECRET was independently set, not just
    // whether what it resolves to happens to look non-default.
    process.env['NODE_ENV'] = 'production';
    setSecureBaseline();
    delete process.env['EXCHANGE_BRIDGE_SECRET'];

    const { checkProductionSecretSafety, logger } = loadFresh();
    checkProductionSecretSafety();
    expect(logger.error).toHaveBeenCalledWith(
      expect.stringContaining('EXCHANGE_BRIDGE_SECRET is INSECURE in production'),
    );
  });

  test('SHARE_HMAC_SECRET unset is flagged — it signs every Secure Share token and has a public default', () => {
    process.env['NODE_ENV'] = 'production';
    setSecureBaseline();
    delete process.env['SHARE_HMAC_SECRET'];

    const { checkProductionSecretSafety, logger } = loadFresh();
    expect(() => checkProductionSecretSafety()).not.toThrow();
    expect(logger.error).toHaveBeenCalledWith(
      expect.stringContaining('SHARE_HMAC_SECRET is INSECURE in production'),
    );
  });

  test('VAULT_MASTER_SECRET at its known default is flagged as critical', () => {
    process.env['NODE_ENV'] = 'production';
    setSecureBaseline();
    process.env['VAULT_MASTER_SECRET'] = 'dev_vault_secret_change_in_prod';

    const { checkProductionSecretSafety, logger } = loadFresh();
    checkProductionSecretSafety();
    expect(logger.error).toHaveBeenCalledWith(
      expect.stringContaining('VAULT_MASTER_SECRET is INSECURE in production (critical)'),
    );
  });
});
