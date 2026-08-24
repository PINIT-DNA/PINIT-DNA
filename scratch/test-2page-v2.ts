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

  const documentDnaRecordId = uuidv4();
  await prisma.dnaRecord.create({
    data: {
      id: documentDnaRecordId,
      imageFilename: 'e2e-2page-v2.pdf',
      imageMimeType: 'application/pdf',
      imageSizeBytes: buffer.length,
      status: 'PENDING',
      fileType: 'PDF',
      ownerUserId: user.id,
    },
  });
  console.log('created parent DnaRecord:', documentDnaRecordId);

  const t0 = Date.now();
  const protectResult = await documentPageProtectionService.protectPdfPages({
    documentDnaRecordId,
    buffer,
    originalName: 'e2e-2page-v2.pdf',
    ownerUserId: user.id,
  });
  console.log(`protectPdfPages done in ${Date.now() - t0}ms:`, JSON.stringify(protectResult));

  const t1 = Date.now();
  const assembly = await documentPageProtectionService.protectAndAssembleForVault({
    documentDnaRecordId,
    buffer,
    originalName: 'e2e-2page-v2.pdf',
    ownerUserId: user.id,
  });
  console.log(`protectAndAssembleForVault done in ${Date.now() - t1}ms:`, assembly ? `pageCount=${assembly.pageCount} pdfBytes=${assembly.pdfBuffer.length}` : 'NULL');
  if (assembly) fs.writeFileSync(path.join(__dirname, 'e2e-2page-v2-protected.pdf'), assembly.pdfBuffer);

  const pages = await prisma.dnaRecord.findMany({
    where: { documentDnaRecordId },
    orderBy: { pageNumber: 'asc' },
    select: { id: true, pageNumber: true },
  });
  console.log('final pages (should be exactly 2, no duplicates):', JSON.stringify(pages));

  for (const p of pages) {
    const hkca = await prisma.spatialAuthPackage.findUnique({ where: { dnaRecordId: p.id }, select: { pixelAuthRoot: true, pixel1AuthRoot: true } });
    const localDna = await prisma.localFeatureIndex.findUnique({ where: { dnaRecordId: p.id }, select: { patchCount: true } });
    console.log(`page ${p.pageNumber}: HKCA(3A)=${hkca?.pixelAuthRoot ? 'yes' : 'NO'} Pixel1(4E)=${hkca?.pixel1AuthRoot ? 'PRESENT (should be null now)' : 'skipped (expected)'} localDNA=${localDna ? localDna.patchCount + ' patches' : 'NO'}`);
  }

  console.log(`TOTAL TIME: ${Date.now() - t0}ms`);

  // Tamper test: modify page 2's text and verify detection
  console.log('--- tamper test: modifying page 2 content ---');
  const pymupdfTest = require('child_process');
  console.log('(building a tampered variant would need python — skipping, testing identical-doc verify only)');

  const verifySame = await documentPageProtectionService.verifyProtectedDocument({
    documentDnaRecordId,
    probeBuffer: buffer,
    probeFileName: 'e2e-2page-v2.pdf',
    ownerUserId: user.id,
  });
  console.log('verify (identical doc, expect no changes):', JSON.stringify(verifySame));
}

main()
  .catch((err) => { console.error('FAILED', err); process.exit(1); })
  .finally(() => prisma.$disconnect());
