/**
 * Export vault image as canonical spatial PNG (same sharp decode as enroll/verify).
 * Edit THIS file (one pixel), save as PNG, then Investigate.
 *
 * Usage: npx ts-node -T scripts/tmp-export-spatial-png.ts [dnaRecordId] [outPath]
 */
import 'dotenv/config';
import fs from 'fs';
import path from 'path';
import sharp from 'sharp';
import { prisma } from '../src/lib/prisma';
import { VaultService } from '../src/services/vault/vault.service';
import { decodeImageForSpatialAuth } from '../src/services/spatial/image-decode';
import { verifyExactSpatialAuthForDna } from '../src/services/spatial/verify-exact.service';

async function main() {
  const dnaRecordId = process.argv[2] || 'a22010fc-83d7-4a7b-9668-2e5a22c6ee58';
  const outPath = path.resolve(
    process.argv[3] || path.join(process.env.USERPROFILE || '.', 'Desktop', 'vaibhavi-spatial-base.png'),
  );

  const dna = await prisma.dnaRecord.findUnique({
    where: { id: dnaRecordId },
    select: { ownerUserId: true },
  });
  if (!dna?.ownerUserId) throw new Error('DNA missing owner');

  const vault = await prisma.vaultRecord.findUnique({
    where: { dnaRecordId },
    select: { id: true },
  });
  if (!vault) throw new Error('Vault missing');

  const retrieved = await new VaultService().retrieve(vault.id, dna.ownerUserId);
  const decoded = await decodeImageForSpatialAuth(retrieved.originalBuffer);

  // Rebuild PNG from the exact RGB used by spatial auth (no EXIF rotate, removeAlpha)
  const png = await sharp(decoded.rgb, {
    raw: { width: decoded.width, height: decoded.height, channels: 3 },
  })
    .png()
    .toBuffer();

  fs.mkdirSync(path.dirname(outPath), { recursive: true });
  fs.writeFileSync(outPath, png);

  const self = await verifyExactSpatialAuthForDna({
    dnaRecordId,
    candidateImageBuffer: png,
  });

  console.log('EXPORTED', {
    outPath,
    width: decoded.width,
    height: decoded.height,
    bytes: png.length,
  });
  console.log('PNG_SELF_VERIFY', {
    status: self.status,
    matched: self.matched,
    blocksFailed: self.blocksFailed,
    blocksPassed: self.blocksPassed,
  });

  await prisma.$disconnect();
}

main().catch(async (e) => {
  console.error(e);
  await prisma.$disconnect();
  process.exit(1);
});
