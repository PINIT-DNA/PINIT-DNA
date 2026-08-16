/**
 * One-shot: re-enroll spatial auth from vault post-embed bytes for a DNA id.
 * Usage: npx ts-node -T scripts/tmp-reenroll-spatial-from-vault.ts <dnaRecordId>
 */
import 'dotenv/config';
import { prisma } from '../src/lib/prisma';
import { VaultService } from '../src/services/vault/vault.service';
import { tryEnrollSpatialAuthAfterDna } from '../src/services/spatial/enroll.service';

async function main() {
  const dnaRecordId = process.argv[2];
  if (!dnaRecordId) {
    console.error('Usage: ts-node scripts/tmp-reenroll-spatial-from-vault.ts <dnaRecordId>');
    process.exit(1);
  }

  const dna = await prisma.dnaRecord.findUnique({
    where: { id: dnaRecordId },
    select: { id: true, ownerUserId: true, imageFilename: true },
  });
  if (!dna?.ownerUserId) {
    console.error('DNA not found or missing owner');
    process.exit(1);
  }

  const vault = await prisma.vaultRecord.findUnique({
    where: { dnaRecordId },
    select: { id: true },
  });
  if (!vault) {
    console.error('No vault row for DNA');
    process.exit(1);
  }

  const vaultService = new VaultService();
  const retrieved = await vaultService.retrieve(vault.id, dna.ownerUserId);
  console.log('Retrieved vault bytes', {
    vaultId: vault.id,
    bytes: retrieved.originalBuffer.length,
    mime: retrieved.mimeType,
  });

  const enroll = await tryEnrollSpatialAuthAfterDna({
    imageBuffer: retrieved.originalBuffer,
    dnaRecordId: dna.id,
    ownerUserId: dna.ownerUserId,
  });

  if (!enroll) {
    console.error('Enroll returned null');
    process.exit(1);
  }

  console.log('Re-enrolled spatial from vault bytes', {
    width: enroll.width,
    height: enroll.height,
    blockCount: enroll.blockCount,
    pixel: !!enroll.pixel,
  });
  await prisma.$disconnect();
}

main().catch(async (e) => {
  console.error(e);
  await prisma.$disconnect();
  process.exit(1);
});
