/**
 * Ensures users."socialLinks" exists (Profile page links: LinkedIn, GitHub, Instagram, website, extras).
 * Additive and idempotent. Mirrors prisma/migrations/20261006150000_profile_social_links.
 */
const { PrismaClient } = require('@prisma/client');

const prisma = new PrismaClient();

const SQL = [
  `ALTER TABLE "users" ADD COLUMN IF NOT EXISTS "socialLinks" JSONB`,
];

async function main() {
  for (const sql of SQL) {
    await prisma.$executeRawUnsafe(sql);
  }
  console.log('[ensure-profile-links] ready');
}

main()
  .catch((err) => {
    console.error('[ensure-profile-links] failed', err);
    process.exitCode = 1;
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
