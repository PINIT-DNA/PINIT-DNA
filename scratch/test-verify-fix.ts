/* eslint-disable */
import fs from 'fs';
import path from 'path';
import { prisma } from '../src/lib/prisma';
import { documentPageProtectionService } from '../src/services/documents/document-page-protection.service';

const EXISTING_TEST_USER_ID = '044a0405-acc8-4c02-afe2-dfe9e832b1a2';
const PROTECTED_DOCUMENT_DNA_RECORD_ID = '7e1944cc-9de8-4b31-bdc1-4d0dd63a2601'; // from the last successful protect run (page1=735a92b9, page2=07ae3f96)

async function main() {
  const user = await prisma.user.findUnique({ where: { id: EXISTING_TEST_USER_ID }, select: { id: true } });
  if (!user) throw new Error('test user not found');

  const originalBuffer = fs.readFileSync(path.join(__dirname, 'test-doc-2page.pdf'));
  const tamperedBuffer = fs.readFileSync(path.join(__dirname, 'test-doc-2page-TAMPERED.pdf'));

  console.log('=== TEST 1: verify against the IDENTICAL original document (expect: no changes) ===');
  const verifySame = await documentPageProtectionService.verifyProtectedDocument({
    documentDnaRecordId: PROTECTED_DOCUMENT_DNA_RECORD_ID,
    probeBuffer: originalBuffer,
    probeFileName: 'test-doc-2page.pdf',
    ownerUserId: user.id,
  });
  console.log(JSON.stringify(verifySame, null, 2));

  console.log('\n=== TEST 2: verify against the TAMPERED document (expect: page 2 changed, page 1 unchanged) ===');
  const verifyTampered = await documentPageProtectionService.verifyProtectedDocument({
    documentDnaRecordId: PROTECTED_DOCUMENT_DNA_RECORD_ID,
    probeBuffer: tamperedBuffer,
    probeFileName: 'test-doc-2page-TAMPERED.pdf',
    ownerUserId: user.id,
  });
  console.log(JSON.stringify(verifyTampered, null, 2));

  console.log('\n=== SUMMARY ===');
  console.log('Identical doc — overallTampered:', verifySame?.overallTampered, '(expect false)');
  console.log('  page1 changed:', verifySame?.pages[0]?.changed, '(expect false)');
  console.log('  page2 changed:', verifySame?.pages[1]?.changed, '(expect false)');
  console.log('Tampered doc — overallTampered:', verifyTampered?.overallTampered, '(expect true)');
  console.log('  page1 changed:', verifyTampered?.pages[0]?.changed, '(expect false — untouched)');
  console.log('  page2 changed:', verifyTampered?.pages[1]?.changed, '(expect true — modified)');
}

main()
  .catch((err) => { console.error('FAILED', err); process.exit(1); })
  .finally(() => prisma.$disconnect());
