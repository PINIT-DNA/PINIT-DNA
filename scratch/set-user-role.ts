import { prisma } from '../src/lib/prisma';
async function main() {
  const before = await prisma.user.findUnique({ where: { shortId: 'PINIT-BFDBF2E9' }, select: { shortId: true, role: true } });
  console.log('before:', before);
  const after = await prisma.user.update({ where: { shortId: 'PINIT-BFDBF2E9' }, data: { role: 'SUPER_ADMIN' }, select: { shortId: true, role: true } });
  console.log('after:', after);
}
main().finally(() => prisma.$disconnect());
