import fs from 'fs';
import path from 'path';
import { prisma } from '../src/lib/prisma';

async function main() {
  const videoRows = await prisma.dnaRecord.findMany({
    where: {
      OR: [{ fileType: 'VIDEO' }, { imageMimeType: { startsWith: 'video/' } }],
      videoDnaRecordId: null, // parent videos only, not frames
    },
    include: { vaultRecord: { select: { id: true, originalFileName: true, encryptedFilePath: true } } },
    orderBy: { createdAt: 'desc' },
    take: 10,
  });

  for (const row of videoRows) {
    const vr = row.vaultRecord;
    const fileExists = vr ? fs.existsSync(path.resolve(vr.encryptedFilePath)) : false;
    const frameCount = await prisma.dnaRecord.count({ where: { videoDnaRecordId: row.id } });
    const frameIds = await prisma.dnaRecord.findMany({ where: { videoDnaRecordId: row.id }, select: { id: true } });
    const indexCount = frameIds.length
      ? await prisma.localFeatureIndex.count({ where: { dnaRecordId: { in: frameIds.map((f) => f.id) } } })
      : 0;
    console.log(JSON.stringify({
      dnaRecordId: row.id,
      ownerUserId: row.ownerUserId,
      vaultId: vr?.id ?? null,
      originalFileName: vr?.originalFileName ?? null,
      encFileExists: fileExists,
      frameCount,
      localFeatureIndexCount: indexCount,
      createdAt: row.createdAt,
    }));
  }
}

main().catch((e) => { console.error('FAILED', e); process.exit(1); }).finally(() => prisma.$disconnect());
