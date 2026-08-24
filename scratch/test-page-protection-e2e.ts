/* eslint-disable */
import fs from 'fs';
import path from 'path';
import { prisma } from '../src/lib/prisma';
import { UniversalFileRouter } from '../src/services/universal-file-router';
import { documentPageProtectionService } from '../src/services/documents/document-page-protection.service';

let createdDocId: string | null = null;
let createdUserId: string | null = null;

async function main() {
  // Isolated, clearly-labeled throwaway user — never touch a real account's data.
  const user = await prisma.user.create({
    data: {
      shortId: `e2e-test-${Date.now()}`,
      email: `pinit-e2e-test-${Date.now()}@internal.invalid`,
      fullName: 'PINIT E2E Test User (safe to delete)',
    },
    select: { id: true, email: true },
  });
  createdUserId = user.id;
  console.log('created isolated test user:', user.id, user.email);

  const buffer = fs.readFileSync(path.join(__dirname, 'test-doc.pdf'));
  const router = new UniversalFileRouter();

  const routeResult = await router.route({
    filePath: '',
    originalName: 'e2e-test-doc.pdf',
    declaredMimeType: 'application/pdf',
    sizeBytes: buffer.length,
    buffer,
    ownerUserId: user.id,
  });
  console.log('DNA generate result:', JSON.stringify({
    dnaRecordId: routeResult.dnaRecordId,
    fileType: routeResult.fileType,
    status: routeResult.status,
  }));

  const documentDnaRecordId = routeResult.dnaRecordId;
  createdDocId = documentDnaRecordId;

  // Directly await page protection (router fires it non-blocking) so we can verify.
  const protectResult = await documentPageProtectionService.protectPdfPages({
    documentDnaRecordId,
    buffer,
    originalName: 'e2e-test-doc.pdf',
    ownerUserId: user.id,
  });
  console.log('protectPdfPages result:', JSON.stringify(protectResult));

  // Verify persistence
  const pages = await prisma.dnaRecord.findMany({
    where: { documentDnaRecordId },
    orderBy: { pageNumber: 'asc' },
    select: { id: true, pageNumber: true, status: true },
  });
  console.log('linked page DnaRecords:', JSON.stringify(pages));

  for (const p of pages) {
    const hkca = await prisma.spatialAuthPackage.findUnique({ where: { dnaRecordId: p.id }, select: { id: true, pixelAuthRoot: true } });
    const localDna = await prisma.localFeatureIndex.findUnique({ where: { dnaRecordId: p.id }, select: { id: true, patchCount: true } });
    console.log(`page ${p.pageNumber}: HKCA=${hkca ? 'yes,root=' + (hkca.pixelAuthRoot?.slice(0,12)) : 'NO'} localDNA=${localDna ? 'yes,patches=' + localDna.patchCount : 'NO'}`);
  }

  // Now test vault-store path: embed + reassemble protected PDF
  const assembly = await documentPageProtectionService.protectAndAssembleForVault({
    documentDnaRecordId,
    buffer,
    originalName: 'e2e-test-doc.pdf',
    ownerUserId: user.id,
  });
  console.log('protectAndAssembleForVault:', assembly ? `pageCount=${assembly.pageCount} pdfBytes=${assembly.pdfBuffer.length}` : 'NULL');
  if (assembly) {
    fs.writeFileSync(path.join(__dirname, 'e2e-protected.pdf'), assembly.pdfBuffer);
  }

  await cleanup(documentDnaRecordId, user.id);
}

async function cleanup(documentDnaRecordId: string, userId: string): Promise<void> {
  await prisma.dnaRecord.deleteMany({ where: { documentDnaRecordId } });
  await prisma.dnaRecord.delete({ where: { id: documentDnaRecordId } }).catch((e) => console.log('parent delete note:', String(e).slice(0, 200)));
  await prisma.user.delete({ where: { id: userId } }).catch((e) => console.log('user delete note:', String(e).slice(0, 200)));
  console.log('cleanup done — isolated test user + all test records removed');
}

main()
  .catch(async (err) => {
    console.error('FAILED', err);
    if (createdDocId && createdUserId) await cleanup(createdDocId, createdUserId).catch(() => {});
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
