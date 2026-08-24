import { prisma } from '../src/lib/prisma';

async function main() {
  const testUsers = await prisma.user.findMany({
    where: { email: { contains: 'test' } },
    select: { id: true, email: true },
    take: 5,
  });
  console.log('test-like users:', JSON.stringify(testUsers));

  const total = await prisma.user.count();
  console.log('total users:', total);
}

main().catch((e) => { console.error(e); process.exit(1); }).finally(() => prisma.$disconnect());
