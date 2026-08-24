/**
 * Shared helper for the biometric-auth integration suite. These tests exercise
 * biometricAuthService.register()/login() against a REAL Postgres connection —
 * the race-condition fix is a `pg_advisory_xact_lock`, a real SQL statement, so
 * it cannot be meaningfully verified against a mocked Prisma client.
 *
 * Point DATABASE_URL_TEST at a disposable Postgres database with migrations
 * already applied (`prisma migrate deploy` against it once, out of band — these
 * tests never run migrations themselves). Every file in this folder calls
 * `requireTestDb()` at the top of its top-level describe and skips cleanly if
 * DATABASE_URL_TEST is unset, so `npm test` never requires a live Postgres.
 *
 * IMPORTANT: resetAuthTables() truncates ONLY the biometric-auth tables listed
 * below — never anything from Vault/DNA/Assets/Exchange/etc. Do not add tables
 * outside this module's scope to this list.
 */
import { PrismaClient } from '@prisma/client';

let client: PrismaClient | null = null;

export function requireTestDb(): boolean {
  return Boolean(process.env['DATABASE_URL_TEST']);
}

export function testDb(): PrismaClient {
  if (!client) {
    if (!requireTestDb()) {
      throw new Error('DATABASE_URL_TEST is not set — call requireTestDb() and skip before reaching this point.');
    }
    client = new PrismaClient({
      datasources: { db: { url: process.env['DATABASE_URL_TEST'] } },
    });
  }
  return client;
}

const AUTH_TABLES = [
  'refresh_tokens',
  'user_sessions',
  'user_devices',
  'security_events',
  'login_history',
  'webauthn_credentials',
  'fingerprint_templates',
  'voice_templates',
  'face_templates',
  'biometric_identities',
  'users',
] as const;

/** Truncate only biometric-auth tables, cascading FKs within that same set. */
export async function resetAuthTables(): Promise<void> {
  const db = testDb();
  await db.$executeRawUnsafe(`TRUNCATE TABLE ${AUTH_TABLES.map((t) => `"${t}"`).join(', ')} RESTART IDENTITY CASCADE`);
}

export async function countRows(table: (typeof AUTH_TABLES)[number]): Promise<number> {
  const db = testDb();
  const rows = await db.$queryRawUnsafe<Array<{ n: bigint }>>(`SELECT COUNT(*)::bigint AS n FROM "${table}"`);
  return Number(rows[0]?.n ?? 0);
}

export async function closeTestDb(): Promise<void> {
  if (client) {
    await client.$disconnect();
    client = null;
  }
}
