/**
 * Backfill Python tile FAISS index from vault images.
 * Run: npx tsx scripts/backfill-tile-faiss.ts
 */
import { prisma } from '../src/lib/prisma';
import { VaultService } from '../src/services/vault/vault.service';
import { forensicScannerService } from '../src/services/forensics/forensic-scanner.service';

const vaultService = new VaultService();

async function main() {
  const rows = await prisma.localFeatureIndex.findMany({
    where: { status: 'COMPLETE' },
    select: {
      vaultId: true,
      dnaRecordId: true,
      ownerUserId: true,
      vault: { select: { originalFilename: true, mimeType: true } },
    },
    take: 500,
  });

  console.log(`Backfilling tile FAISS for ${rows.length} vault images…`);
  let ok = 0;
  let fail = 0;

  for (const row of rows) {
    const mime = row.vault?.mimeType ?? 'image/jpeg';
    if (!mime.startsWith('image/')) continue;
    try {
      const file = await vaultService.retrieve(row.vaultId, row.ownerUserId);
      const indexed = await forensicScannerService.indexVaultTiles(
        file.originalBuffer,
        file.originalMimeType || mime,
        row.vaultId,
        row.dnaRecordId,
      );
      if (indexed) {
        ok++;
        console.log(`  ✓ ${row.vault?.originalFilename ?? row.vaultId.slice(0, 8)}`);
      } else {
        fail++;
      }
    } catch (e) {
      fail++;
      console.warn(`  ✗ ${row.vaultId.slice(0, 8)}: ${String(e)}`);
    }
  }

  console.log(`Done — indexed: ${ok}, failed: ${fail}`);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
