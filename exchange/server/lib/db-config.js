/**
 * Choose Exchange's database driver from env — never from request input.
 *
 * Production must use Postgres. SQLite is only for local development and
 * isolated tests. A missing URL in production used to open exchange.db, which
 * looks like a healthy marketplace with empty data.
 */

const POSTGRES_URL = /^(postgres(?:ql)?:\/\/)/i;

function flagOn(env, name) {
  return String(env[name] || '').trim() === '1';
}

function isProduction(env) {
  return String(env.NODE_ENV || '').trim() === 'production';
}

function postgresUrlFromEnv(env, { production }) {
  const exchangeUrl = String(env.EXCHANGE_DATABASE_URL || '').trim();
  if (exchangeUrl) return exchangeUrl;
  // Production also accepts DATABASE_URL (Render/Vercel/Supabase naming).
  // Locally we ignore a Hub DATABASE_URL so `npm run server` still uses SQLite
  // unless Exchange is explicitly pointed at Postgres.
  if (production) return String(env.DATABASE_URL || '').trim();
  return '';
}

export function isPostgresConnectionString(url) {
  return POSTGRES_URL.test(String(url || '').trim());
}

/**
 * @param {NodeJS.ProcessEnv} [env]
 * @returns {{ driver: 'postgres' | 'sqlite', url: string, sqliteAllowed: boolean }}
 */
export function resolveDatabaseConfig(env = process.env) {
  const isolated = flagOn(env, 'EXCHANGE_ISOLATED_TEST');
  const forceSqlite = flagOn(env, 'EXCHANGE_FORCE_SQLITE');
  const production = isProduction(env);

  if (isolated) {
    return { driver: 'sqlite', url: '', sqliteAllowed: true };
  }

  if (production) {
    if (forceSqlite) {
      throw new Error(
        'FATAL: EXCHANGE_FORCE_SQLITE is not allowed in production. '
        + 'Set EXCHANGE_DATABASE_URL or DATABASE_URL to a postgresql:// connection string. '
        + 'Refusing to fall back to a local SQLite file.',
      );
    }
    const url = postgresUrlFromEnv(env, { production: true });
    if (!url) {
      throw new Error(
        'FATAL: Exchange production requires EXCHANGE_DATABASE_URL or DATABASE_URL. '
        + 'Refusing to start with a local SQLite database.',
      );
    }
    if (!isPostgresConnectionString(url)) {
      throw new Error(
        'FATAL: EXCHANGE_DATABASE_URL / DATABASE_URL must be a postgresql:// (or postgres://) connection string. '
        + 'Refusing to start.',
      );
    }
    return { driver: 'postgres', url, sqliteAllowed: false };
  }

  if (forceSqlite) {
    return { driver: 'sqlite', url: '', sqliteAllowed: true };
  }

  const url = postgresUrlFromEnv(env, { production: false });
  if (!url) {
    return { driver: 'sqlite', url: '', sqliteAllowed: true };
  }
  if (!isPostgresConnectionString(url)) {
    throw new Error(
      'FATAL: EXCHANGE_DATABASE_URL is set but is not a postgresql:// connection string. Refusing to start.',
    );
  }
  return { driver: 'postgres', url, sqliteAllowed: false };
}
