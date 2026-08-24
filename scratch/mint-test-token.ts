import jwt from 'jsonwebtoken';
import { config } from '../src/config/index';
import { prisma } from '../src/lib/prisma';

const EXISTING_TEST_USER_ID = '044a0405-acc8-4c02-afe2-dfe9e832b1a2';

async function main() {
  const user = await prisma.user.findUnique({ where: { id: EXISTING_TEST_USER_ID }, select: { id: true, shortId: true, fullName: true, role: true } });
  if (!user) throw new Error('test user not found');
  const token = jwt.sign(
    { sub: user.id, shortId: user.shortId, name: user.fullName, role: user.role },
    config.jwt.secret,
    { expiresIn: '1h' },
  );
  console.log(token);
}

main().catch((e) => { console.error(e); process.exit(1); }).finally(() => prisma.$disconnect());
