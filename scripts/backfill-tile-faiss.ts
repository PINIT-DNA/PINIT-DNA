/**
 * Backfill Python tile FAISS + CLIP index from vault images.
 * Run: npx tsx scripts/backfill-tile-faiss.ts
 */
import { prisma } from '../src/lib/prisma';
import { VaultService } from '../src/services/vault/vault.service';
import { forensicScannerService } from '../src/services/forensics/forensic-scanner.service';

const vaultService = new VaultService();

async function main() {
  const rows = await prisma.localFeatureIndex.findMany({
    where: {
      status: 'COMPLETE',
      vaultId: { not: null },
    },
    select: {
      vaultId: true,
      dnaRecordId: true,
      ownerUserId: true,
      dnaRecord: {
        select: {
          imageFilename: true,
          imageMimeType: true,
          vaultRecord: { select: { id: true, originalFileName: true, originalMimeType: true } },
        },
      },
    },
    take: 500,
  });

  console.log(`Backfilling tile FAISS for ${rows.length} vault images…`);
  let ok = 0;
  let fail = 0;
  let skipped = 0;

  for (const row of rows) {
    const vaultId = row.vaultId ?? row.dnaRecord.vaultRecord?.id;
    if (!vaultId) {
      skipped++;
      continue;
    }

    const mime = row.dnaRecord.vaultRecord?.originalMimeType
      ?? row.dnaRecord.imageMimeType
      ?? 'image/jpeg';
    if (!mime.startsWith('image/')) {
      skipped++;
      continue;
    }

    const label = row.dnaRecord.vaultRecord?.originalFileName
      ?? row.dnaRecord.imageFilename
      ?? vaultId.slice(0, 8);

    try {
      const file = await vaultService.retrieve(vaultId, row.ownerUserId);
      const indexed = await forensicScannerService.indexVaultTiles(
        file.originalBuffer,
        file.originalMimeType || mime,
        vaultId,
        row.dnaRecordId,
      );
      if (indexed) {
        ok++;
        console.log(`  ✓ ${label}`);
      } else {
        fail++;
        console.warn(`  ✗ ${label} — Python AI offline or index failed`);
      }
    } catch (e) {
      fail++;
      console.warn(`  ✗ ${label}: ${String(e)}`);
    }
  }

  console.log(`Done — indexed: ${ok}, failed: ${fail}, skipped: ${skipped}`);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
