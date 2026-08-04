/**
 * PINIT-DNA — Prisma Client Singleton
 *
 * Exports a single PrismaClient instance. In development, re-uses the instance
 * across hot-reloads to avoid exhausting the connection pool.
 */

import { PrismaClient } from '@prisma/client';
import { logger } from './logger';

const globalForPrisma = globalThis as unknown as { prisma: PrismaClient };

/** Query logging is expensive and floods the event loop — opt in with PRISMA_LOG_QUERIES=1. */
const prismaLog: Array<{ emit: 'event'; level: 'query' | 'error' | 'warn' }> = [
  { emit: 'event', level: 'error' },
  { emit: 'event', level: 'warn' },
];
if (process.env['PRISMA_LOG_QUERIES'] === '1' || process.env['PRISMA_LOG_QUERIES'] === 'true') {
  prismaLog.unshift({ emit: 'event', level: 'query' });
}

function withSafePoolParams(url: string | undefined): string | undefined {
  if (!url) return url;
  try {
    const u = new URL(url);
    // Keep pool modest so background jobs cannot starve interactive API requests.
    if (!u.searchParams.has('connection_limit')) {
      u.searchParams.set('connection_limit', process.env['NODE_ENV'] === 'production' ? '10' : '10');
    }
    if (!u.searchParams.has('pool_timeout')) {
      u.searchParams.set('pool_timeout', '20');
    }
    return u.toString();
  } catch {
    return url;
  }
}

const databaseUrl = withSafePoolParams(process.env['DATABASE_URL']);

const prismaClient =
  globalForPrisma.prisma ??
  new PrismaClient({
    log: prismaLog,
    ...(databaseUrl ? { datasources: { db: { url: databaseUrl } } } : {}),
  });

/** DNA records are immutable — hard deletes are blocked application-wide. */
if (!(globalForPrisma as { dnaGuardInstalled?: boolean }).dnaGuardInstalled) {
  prismaClient.$use(async (params, next) => {
    if (
      params.model === 'DnaRecord'
      && (params.action === 'delete' || params.action === 'deleteMany')
    ) {
      logger.error('Blocked DNA delete attempt', { action: params.action, args: params.args });
      throw new Error(
        'DNA_IMMUTABLE: DNA records cannot be deleted. Users may only delete vault files.',
      );
    }
    return next(params);
  });
  (globalForPrisma as { dnaGuardInstalled?: boolean }).dnaGuardInstalled = true;
}

export const prisma = prismaClient;

// eslint-disable-next-line @typescript-eslint/no-explicit-any
(prisma as any).$on('error', (e: { message: string }) => logger.error('Prisma error', { message: e.message }));
// eslint-disable-next-line @typescript-eslint/no-explicit-any
(prisma as any).$on('warn',  (e: { message: string }) => logger.warn('Prisma warning', { message: e.message }));

if (process.env.NODE_ENV !== 'production') {
  globalForPrisma.prisma = prisma;
}
