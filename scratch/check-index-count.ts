import { prisma } from '../src/lib/prisma';
async function main() {
  const total = await prisma.localFeatureIndex.count({ where: { ownerUserId: '0712e895-aee0-4aac-b80b-abca89341f3d' } });
  console.log('total LocalFeatureIndex rows for this user:', total);
  const frameIds = await prisma.dnaRecord.findMany({
    where: { videoDnaRecordId: { not: null }, ownerUserId: '0712e895-aee0-4aac-b80b-abca89341f3d' },
    select: { id: true },
  });
  console.log('video frame dnaRecordIds for this user:', frameIds.length);
  const indexed = await prisma.localFeatureIndex.count({ where: { dnaRecordId: { in: frameIds.map(f=>f.id) } } });
  console.log('of those, how many have a LocalFeatureIndex:', indexed);
}
main().catch(e=>{console.error(e);process.exit(1);}).finally(()=>prisma.$disconnect());
