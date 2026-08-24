import { prisma } from '../src/lib/prisma';

async function main() {
  const orphanUsers = await prisma.user.findMany({
    where: { email: { contains: 'pinit-e2e-test-' } },
    select: { id: true, email: true },
  });
  console.log('orphaned test users found:', JSON.stringify(orphanUsers));

  for (const u of orphanUsers) {
    const docs = await prisma.dnaRecord.findMany({ where: { ownerUserId: u.id }, select: { id: true } });
    console.log(`user ${u.id} has ${docs.length} dnaRecords`);
    for (const d of docs) {
      await prisma.dnaRecord.deleteMany({ where: { documentDnaRecordId: d.id } });
    }
    await prisma.dnaRecord.deleteMany({ where: { ownerUserId: u.id } });
    await prisma.user.delete({ where: { id: u.id } });
    console.log(`cleaned up user ${u.id}`);
  }
  console.log('done');
}

main().catch((e) => { console.error(e); process.exit(1); }).finally(() => prisma.$disconnect());
