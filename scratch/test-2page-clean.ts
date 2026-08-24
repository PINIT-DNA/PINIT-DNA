/* eslint-disable */
import fs from 'fs';
import path from 'path';
import { v4 as uuidv4 } from 'uuid';
import { prisma } from '../src/lib/prisma';
import { documentPageProtectionService } from '../src/services/documents/document-page-protection.service';

const EXISTING_TEST_USER_ID = '044a0405-acc8-4c02-afe2-dfe9e832b1a2';

async function main() {
  const user = await prisma.user.findUnique({ where: { id: EXISTING_TEST_USER_ID }, select: { id: true, email: true } });
  if (!user) throw new Error('Expected existing test user not found');
  console.log('reusing existing test user:', user.id, user.email);

  const buffer = fs.readFileSync(path.join(__dirname, 'test-doc-2page.pdf'));

  // Create a minimal parent DnaRecord directly (skip the router's own
  // text-DNA + auto-fire page protection — we want ONE deterministic,
  // awaited pass through the page-protection pipeline, not a background race).
  const documentDnaRecordId = uuidv4();
  await prisma.dnaRecord.create({
    data: {
      id: documentDnaRecordId,
      imageFilename: 'e2e-2page-test.pdf',
      imageMimeType: 'application/pdf',
      imageSizeBytes: buffer.length,
      status: 'PENDING',
      fileType: 'PDF',
      ownerUserId: user.id,
    },
  });
  console.log('created parent DnaRecord:', documentDnaRecordId);

  console.log('--- protectPdfPages (DNA-generate-time seeding) ---');
  const t0 = Date.now();
  const protectResult = await documentPageProtectionService.protectPdfPages({
    documentDnaRecordId,
    buffer,
    originalName: 'e2e-2page-test.pdf',
    ownerUserId: user.id,
  });
  console.log(`protectPdfPages done in ${Date.now() - t0}ms:`, JSON.stringify(protectResult));

  const pagesAfterFirst = await prisma.dnaRecord.findMany({
    where: { documentDnaRecordId },
    orderBy: { pageNumber: 'asc' },
    select: { id: true, pageNumber: true, status: true },
  });
  console.log('pages after protectPdfPages:', JSON.stringify(pagesAfterFirst));

  console.log('--- protectAndAssembleForVault (vault-store-time embed + reassembly) ---');
  const t1 = Date.now();
  const assembly = await documentPageProtectionService.protectAndAssembleForVault({
    documentDnaRecordId,
    buffer,
    originalName: 'e2e-2page-test.pdf',
    ownerUserId: user.id,
  });
  console.log(`protectAndAssembleForVault done in ${Date.now() - t1}ms:`, assembly ? `pageCount=${assembly.pageCount} pdfBytes=${assembly.pdfBuffer.length}` : 'NULL');
  if (assembly) {
    fs.writeFileSync(path.join(__dirname, 'e2e-2page-protected.pdf'), assembly.pdfBuffer);
    console.log('wrote scratch/e2e-2page-protected.pdf');
  }

  // Verify NO duplicate pages were created (the bug we just fixed)
  const pagesAfterSecond = await prisma.dnaRecord.findMany({
    where: { documentDnaRecordId },
    orderBy: { pageNumber: 'asc' },
    select: { id: true, pageNumber: true },
  });
  console.log('pages after protectAndAssembleForVault (should be SAME ids as before, no duplicates):', JSON.stringify(pagesAfterSecond));
  const idsMatch = JSON.stringify(pagesAfterFirst.map(p => p.id).sort()) === JSON.stringify(pagesAfterSecond.map(p => p.id).sort());
  console.log('IDEMPOTENCY CHECK:', idsMatch ? 'PASS — same page ids reused, no duplicates' : 'FAIL — duplicate pages created');

  for (const p of pagesAfterSecond) {
    const hkca = await prisma.spatialAuthPackage.findUnique({ where: { dnaRecordId: p.id }, select: { pixelAuthRoot: true, width: true, height: true } });
    const localDna = await prisma.localFeatureIndex.findUnique({ where: { dnaRecordId: p.id }, select: { patchCount: true } });
    console.log(`page ${p.pageNumber} (${p.id.slice(0,8)}): HKCA=${hkca ? 'yes ' + hkca.width + 'x' + hkca.height : 'NO'} localDNA=${localDna ? localDna.patchCount + ' patches' : 'NO'}`);
  }

  console.log('--- verifyProtectedDocument (tamper detection, using the SAME unmodified doc — expect no changes) ---');
  const verifySame = await documentPageProtectionService.verifyProtectedDocument({
    documentDnaRecordId,
    probeBuffer: buffer,
    probeFileName: 'e2e-2page-test.pdf',
    ownerUserId: user.id,
  });
  console.log('verify (identical doc):', JSON.stringify(verifySame));

  console.log('NOTE: DnaRecords are immutable by app policy — these test rows will remain permanently under the labeled test account:', user.email);
}

main()
  .catch((err) => { console.error('FAILED', err); process.exit(1); })
  .finally(() => prisma.$disconnect());
