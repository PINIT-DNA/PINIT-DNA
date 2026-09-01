import test from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'child_process';
import path from 'path';
import { fileURLToPath } from 'url';
import { resolveDatabaseConfig, isPostgresConnectionString } from '../lib/db-config.js';

const exchangeRoot = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', '..');

test('isPostgresConnectionString accepts postgres URLs only', () => {
  assert.equal(isPostgresConnectionString('postgresql://u:p@host/db'), true);
  assert.equal(isPostgresConnectionString('postgres://u:p@host/db'), true);
  assert.equal(isPostgresConnectionString('sqlite:./exchange.db'), false);
  assert.equal(isPostgresConnectionString(''), false);
});

test('local development omits URL → sqlite', () => {
  const cfg = resolveDatabaseConfig({ NODE_ENV: 'development' });
  assert.equal(cfg.driver, 'sqlite');
});

test('EXCHANGE_FORCE_SQLITE wins locally even if a URL is set', () => {
  const cfg = resolveDatabaseConfig({
    NODE_ENV: 'development',
    EXCHANGE_FORCE_SQLITE: '1',
    EXCHANGE_DATABASE_URL: 'postgresql://u:p@localhost/db',
  });
  assert.equal(cfg.driver, 'sqlite');
});

test('isolated E2E stays on sqlite even in NODE_ENV=production', () => {
  const cfg = resolveDatabaseConfig({
    NODE_ENV: 'production',
    EXCHANGE_ISOLATED_TEST: '1',
    EXCHANGE_FORCE_SQLITE: '1',
    DATABASE_URL: 'postgresql://prod:secret@db.example/postgres',
    EXCHANGE_DATABASE_URL: 'postgresql://prod:secret@db.example/postgres',
  });
  assert.equal(cfg.driver, 'sqlite');
  assert.equal(cfg.url, '');
});

test('local Hub DATABASE_URL does not silently switch Exchange to Postgres', () => {
  const cfg = resolveDatabaseConfig({
    NODE_ENV: 'development',
    DATABASE_URL: 'postgresql://hub:secret@db.example/postgres',
  });
  assert.equal(cfg.driver, 'sqlite');
});

test('local EXCHANGE_DATABASE_URL selects postgres', () => {
  const cfg = resolveDatabaseConfig({
    NODE_ENV: 'development',
    EXCHANGE_DATABASE_URL: 'postgresql://u:p@localhost/exchange',
  });
  assert.equal(cfg.driver, 'postgres');
});

test('production missing URL fails fast — no sqlite fallback', () => {
  assert.throws(
    () => resolveDatabaseConfig({ NODE_ENV: 'production' }),
    (err) => /FATAL/i.test(err.message) && /EXCHANGE_DATABASE_URL|DATABASE_URL/i.test(err.message) && /sqlite/i.test(err.message),
  );
});

test('production FORCE_SQLITE is refused', () => {
  assert.throws(
    () => resolveDatabaseConfig({ NODE_ENV: 'production', EXCHANGE_FORCE_SQLITE: '1' }),
    (err) => /FATAL/i.test(err.message) && /FORCE_SQLITE/i.test(err.message),
  );
});

test('production invalid URL fails fast', () => {
  assert.throws(
    () => resolveDatabaseConfig({ NODE_ENV: 'production', DATABASE_URL: 'not-a-postgres-url' }),
    (err) => /FATAL/i.test(err.message) && /postgresql/i.test(err.message),
  );
});

test('production accepts DATABASE_URL when EXCHANGE_DATABASE_URL is unset', () => {
  const cfg = resolveDatabaseConfig({
    NODE_ENV: 'production',
    DATABASE_URL: 'postgresql://u:p@db.example:5432/postgres',
  });
  assert.equal(cfg.driver, 'postgres');
  assert.match(cfg.url, /^postgresql:/);
});

test('production prefers EXCHANGE_DATABASE_URL over DATABASE_URL', () => {
  const cfg = resolveDatabaseConfig({
    NODE_ENV: 'production',
    DATABASE_URL: 'postgresql://hub@db/hub',
    EXCHANGE_DATABASE_URL: 'postgresql://ex@db/exchange',
  });
  assert.equal(cfg.url, 'postgresql://ex@db/exchange');
});

function spawnExchange(env) {
  return new Promise((resolve) => {
    const proc = spawn(process.execPath, ['server/server.js'], {
      cwd: exchangeRoot,
      env: {
        ...process.env,
        EXCHANGE_ISOLATED_TEST: '',
        EXCHANGE_FORCE_SQLITE: '',
        EXCHANGE_IGNORE_DOTENV: '1',
        PORT: String(19876 + Math.floor(Math.random() * 200)),
        ...env,
      },
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    let buf = '';
    const onChunk = (c) => { buf += c.toString(); };
    proc.stdout.on('data', onChunk);
    proc.stderr.on('data', onChunk);
    const timer = setTimeout(() => {
      proc.kill();
      resolve({ code: null, buf, timedOut: true });
    }, 12_000);
    proc.on('exit', (code) => {
      clearTimeout(timer);
      resolve({ code, buf, timedOut: false });
    });
  });
}

test('production process with no DATABASE_URL exits before listen', async () => {
  const { code, buf, timedOut } = await spawnExchange({
    NODE_ENV: 'production',
    EXCHANGE_DATABASE_URL: '',
    DATABASE_URL: '',
  });
  assert.equal(timedOut, false, buf.slice(-500));
  assert.notEqual(code, 0);
  assert.match(buf, /FATAL/i);
  assert.doesNotMatch(buf, /\[exchange\] ready/);
  assert.doesNotMatch(buf, /Database driver: sqlite/i);
});

test('production process with invalid DATABASE_URL does not fall back to sqlite', async () => {
  const { code, buf, timedOut } = await spawnExchange({
    NODE_ENV: 'production',
    DATABASE_URL: 'postgresql://pinit:pinit@127.0.0.1:1/no_such_db',
    EXCHANGE_DATABASE_URL: '',
  });
  assert.equal(timedOut, false, buf.slice(-800));
  assert.notEqual(code, 0);
  assert.match(buf, /FATAL/i);
  assert.doesNotMatch(buf, /\[exchange\] ready/);
  assert.doesNotMatch(buf, /Database driver: sqlite/i);
});
