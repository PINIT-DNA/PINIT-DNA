import { prisma } from '../src/lib/prisma';
async function main() {
  const users = await prisma.user.findMany({
    select: { shortId: true, fullName: true, email: true, phone: true, organization: true, country: true, createdAt: true, lastLoginAt: true, authMethod: true },
  });
  console.log(JSON.stringify(users, null, 2));
}
main().finally(() => prisma.$disconnect());
