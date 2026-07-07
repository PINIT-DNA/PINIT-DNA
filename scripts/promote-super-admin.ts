/**
 * Promote a user to SUPER_ADMIN (local dev helper).
 * Usage: npx ts-node scripts/promote-super-admin.ts [shortId]
 */
import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

async function main() {
  const shortId = process.argv[2];

  if (shortId) {
    const user = await prisma.user.update({
      where: { shortId },
      data: { role: 'SUPER_ADMIN' },
      select: { shortId: true, fullName: true, role: true },
    });
    console.log('Promoted:', user);
    return;
  }

  const users = await prisma.user.findMany({
    select: { id: true, shortId: true, fullName: true, role: true, email: true },
    orderBy: { createdAt: 'desc' },
    take: 10,
  });

  console.log('\nRecent users (pass shortId as argument to promote):\n');
  for (const u of users) {
    console.log(`  ${u.shortId}  role=${u.role}  ${u.fullName ?? ''}  ${u.email ?? ''}`);
  }
  console.log('\nExample: npx ts-node scripts/promote-super-admin.ts PINIT-XXXXXXXX\n');
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
