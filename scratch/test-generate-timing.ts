/* eslint-disable */
import fs from 'fs';
import path from 'path';
import { prisma } from '../src/lib/prisma';
import { UniversalFileRouter } from '../src/services/universal-file-router';

const EXISTING_TEST_USER_ID = '044a0405-acc8-4c02-afe2-dfe9e832b1a2';

async function main() {
  const user = await prisma.user.findUnique({ where: { id: EXISTING_TEST_USER_ID }, select: { id: true } });
  if (!user) throw new Error('test user not found');

  const buffer = fs.readFileSync(path.join(__dirname, 'test-doc-5page.pdf'));
  const router = new UniversalFileRouter();

  console.log('=== Timing the exact call /api/v1/dna/generate makes (router.route) ===');
  const t0 = Date.now();
  const result = await router.route({
    filePath: '',
    originalName: 'progress-report-5page.pdf',
    declaredMimeType: 'application/pdf',
    sizeBytes: buffer.length,
    buffer,
    ownerUserId: user.id,
  });
  const elapsed = Date.now() - t0;
  console.log(`router.route() (= /dna/generate response time) took ${elapsed}ms`);
  console.log('30s frontend timeout would', elapsed > 30000 ? 'FIRE (this IS the bug)' : 'NOT fire');
  console.log('result:', JSON.stringify({ dnaRecordId: result.dnaRecordId, status: result.status, fileType: result.fileType }));
}

main()
  .catch((err) => { console.error('FAILED', err); process.exit(1); })
  .finally(() => prisma.$disconnect());
