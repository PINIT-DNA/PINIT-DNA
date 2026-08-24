/* eslint-disable */
import fs from 'fs';
import path from 'path';
import { PDFDocument } from 'pdf-lib';
import { identityEmbeddingService } from '../src/services/identity/identity-embedding.service';

async function main() {
  const raw = fs.readFileSync(path.join(__dirname, 'page1.png'));
  console.log('raw page1.png size:', raw.length);

  const embedResult = await identityEmbeddingService.embed(
    raw,
    'image/png',
    'page-1.png',
    { dnaId: 'test-page-dna-id', vaultId: 'test-document-dna-id', ownerUserId: 'test-owner' },
  );
  console.log('embed success:', embedResult.success, 'method:', embedResult.method);
  console.log('embedded buffer size:', embedResult.buffer.length);

  // Verify round-trip extraction
  const verify = await identityEmbeddingService.extractAndVerify(embedResult.buffer, 'image/png', 'page-1.png');
  console.log('extractAndVerify:', JSON.stringify(verify));

  // Reassemble a 1-page protected PDF exactly like protectAndAssembleForVault does
  const dpi = 100;
  // page1.png was rendered at 827x1170 (dpi=100 from earlier rasterize test)
  const width = 827, height = 1170;
  const pdfDoc = await PDFDocument.create();
  const img = await pdfDoc.embedPng(embedResult.buffer);
  const widthPt = (width * 72) / dpi;
  const heightPt = (height * 72) / dpi;
  const pdfPage = pdfDoc.addPage([widthPt, heightPt]);
  pdfPage.drawImage(img, { x: 0, y: 0, width: widthPt, height: heightPt });
  const pdfBytes = await pdfDoc.save();
  fs.writeFileSync(path.join(__dirname, 'protected-test.pdf'), Buffer.from(pdfBytes));
  console.log('protected PDF written, size:', pdfBytes.length);
}

main().catch((err) => {
  console.error('FAILED', err);
  process.exit(1);
});
