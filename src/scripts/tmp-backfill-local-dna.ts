import 'dotenv/config';
import { prisma } from '../lib/prisma';
import { localDnaIndexService } from '../services/forensics/local-dna-index.service';

async function main() {
  const user = await prisma.user.findFirst({
    where: { shortId: 'PINIT-324BMMSL' },
    select: { id: true, shortId: true },
  });
  if (!user) throw new Error('user not found');

  console.log('Backfilling local DNA for', user.shortId);
  const result = await localDnaIndexService.backfillOwner(user.id);
  console.log('Result:', result);

  const idx = await prisma.localFeatureIndex.findMany({
    where: { ownerUserId: user.id },
    select: { vaultId: true, patchCount: true, indexVersion: true },
  });
  console.log('Indexes after backfill:', idx);
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
