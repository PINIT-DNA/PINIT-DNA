/**
 * Passkey public keys bound 1:1 to a Pinit user (credentialId UNIQUE → userId).
 *
 * Every function accepts an optional `db` (a Prisma.TransactionClient) so callers
 * that need these reads/writes inside a locked transaction (see biometric-auth.service.ts's
 * register()) can pass `tx` — defaults to the ambient `prisma` singleton otherwise.
 */
import crypto from 'crypto';
import { Prisma, type PrismaClient } from '@prisma/client';
import { prisma } from '../../lib/prisma';

type Db = PrismaClient | Prisma.TransactionClient;

export interface StoredWebAuthnCredential {
  credentialId: string;
  publicKey: string;
  userId: string;
  signCount: number;
  transports: string[];
}

export async function findWebAuthnByCredentialId(credentialId: string, db: Db = prisma): Promise<StoredWebAuthnCredential | null> {
  const rows = await db.$queryRaw<Array<{
    credentialId: string;
    publicKey: string;
    userId: string;
    signCount: number;
    transports: string[] | null;
  }>>`
    SELECT "credentialId", "publicKey", "userId", "signCount", transports
    FROM webauthn_credentials
    WHERE "credentialId" = ${credentialId}
    LIMIT 1
  `;
  const row = rows[0];
  if (!row) return null;
  return {
    credentialId: row.credentialId,
    publicKey: row.publicKey,
    userId: row.userId,
    signCount: row.signCount,
    transports: row.transports ?? [],
  };
}

export async function listWebAuthnByUserId(userId: string, db: Db = prisma): Promise<Array<{ credentialId: string; transports: string[] }>> {
  const rows = await db.$queryRaw<Array<{ credentialId: string; transports: string[] | null }>>`
    SELECT "credentialId", transports
    FROM webauthn_credentials
    WHERE "userId" = ${userId}
  `;
  return rows.map((r) => ({ credentialId: r.credentialId, transports: r.transports ?? [] }));
}

export async function countWebAuthnByUserId(userId: string, db: Db = prisma): Promise<number> {
  const rows = await db.$queryRaw<Array<{ n: bigint }>>`
    SELECT COUNT(*)::bigint AS n FROM webauthn_credentials WHERE "userId" = ${userId}
  `;
  return Number(rows[0]?.n ?? 0);
}

export async function insertWebAuthnCredential(data: {
  credentialId: string;
  publicKey: string;
  userId: string;
  signCount: number;
  transports?: string[];
  deviceType?: string;
  backedUp?: boolean;
}, db: Db = prisma): Promise<void> {
  const id = crypto.randomUUID();
  const transports = data.transports ?? [];
  const transportSql = transports.length
    ? Prisma.sql`ARRAY[${Prisma.join(transports)}]::text[]`
    : Prisma.sql`ARRAY[]::text[]`;
  await db.$executeRaw`
    INSERT INTO webauthn_credentials
      ("id", "createdAt", "updatedAt", "credentialId", "publicKey", "userId", "signCount", "deviceType", "backedUp", "transports")
    VALUES
      (${id}, NOW(), NOW(), ${data.credentialId}, ${data.publicKey}, ${data.userId}, ${data.signCount},
       ${data.deviceType ?? null}, ${data.backedUp ?? false}, ${transportSql})
  `;
}

export async function updateWebAuthnSignCount(credentialId: string, signCount: number, db: Db = prisma): Promise<void> {
  await db.$executeRaw`
    UPDATE webauthn_credentials
    SET "signCount" = ${signCount}, "updatedAt" = NOW()
    WHERE "credentialId" = ${credentialId}
  `;
}
