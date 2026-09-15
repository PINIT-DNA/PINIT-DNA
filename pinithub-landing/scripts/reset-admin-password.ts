import { PrismaClient } from '@prisma/client';
import { hashSync } from 'bcryptjs';

const prisma = new PrismaClient();

async function main() {
  const email = (process.env.RESET_EMAIL ?? process.env.SEED_ADMIN_EMAIL ?? 'admin@pinithub.com')
    .trim()
    .toLowerCase();
  const password = process.env.NEW_PASSWORD ?? process.env.SEED_ADMIN_PASSWORD;

  if (!password || password.length < 8) {
    console.error('Set NEW_PASSWORD (min 8 characters).');
    process.exit(1);
  }

  const user = await prisma.user.findUnique({ where: { email } });
  if (!user) {
    console.error(`No user found for ${email}. Run npm run db:seed first.`);
    process.exit(1);
  }

  await prisma.user.update({
    where: { email },
    data: {
      passwordHash: hashSync(password, 12),
      tokenVersion: { increment: 1 },
    },
  });

  console.log(`Password reset for ${email}`);
}

main()
  .catch((error) => {
    console.error(error);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
