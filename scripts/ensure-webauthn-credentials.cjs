/**
 * Ensures webauthn_credentials exists (passkey public keys bound 1:1 to a user).
 */
const { PrismaClient } = require('@prisma/client');

const prisma = new PrismaClient();

const SQL = [
  `CREATE TABLE IF NOT EXISTS "webauthn_credentials" (
    "id" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "credentialId" TEXT NOT NULL,
    "publicKey" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "signCount" INTEGER NOT NULL DEFAULT 0,
    "deviceType" TEXT,
    "backedUp" BOOLEAN NOT NULL DEFAULT false,
    "transports" TEXT[] DEFAULT ARRAY[]::TEXT[],
    CONSTRAINT "webauthn_credentials_pkey" PRIMARY KEY ("id")
  )`,
  `CREATE UNIQUE INDEX IF NOT EXISTS "webauthn_credentials_credentialId_key" ON "webauthn_credentials"("credentialId")`,
  `CREATE INDEX IF NOT EXISTS "webauthn_credentials_userId_idx" ON "webauthn_credentials"("userId")`,
];

async function main() {
  for (const sql of SQL) {
    await prisma.$executeRawUnsafe(sql);
  }
  try {
    await prisma.$executeRawUnsafe(`
      DO $$
      BEGIN
        IF NOT EXISTS (
          SELECT 1 FROM pg_constraint WHERE conname = 'webauthn_credentials_userId_fkey'
        ) THEN
          ALTER TABLE "webauthn_credentials"
            ADD CONSTRAINT "webauthn_credentials_userId_fkey"
            FOREIGN KEY ("userId") REFERENCES "users"("id")
            ON DELETE CASCADE ON UPDATE CASCADE;
        END IF;
      END $$;
    `);
  } catch (err) {
    console.warn('[ensure-webauthn-credentials] FK skipped:', err.message || err);
  }
  console.log('[ensure-webauthn-credentials] ready');
}

main()
  .catch((err) => {
    console.error('[ensure-webauthn-credentials] failed', err);
    process.exitCode = 1;
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
