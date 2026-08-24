/**
 * Diagnose spatial: vault self-verify + optional probe file compare.
 * Usage:
 *   npx ts-node -T scripts/tmp-spatial-diagnose.ts <dnaRecordId> [probePath]
 */
import 'dotenv/config';
import fs from 'fs';
import path from 'path';
import crypto from 'crypto';
import { prisma } from '../src/lib/prisma';
import { VaultService } from '../src/services/vault/vault.service';
import { verifyExactSpatialAuthForDna } from '../src/services/spatial/verify-exact.service';
import { decodeImageForSpatialAuth } from '../src/services/spatial/image-decode';

async function main() {
  const dnaRecordId = process.argv[2] || 'a22010fc-83d7-4a7b-9668-2e5a22c6ee58';
  const probePath = process.argv[3];

  const dna = await prisma.dnaRecord.findUnique({
    where: { id: dnaRecordId },
    select: { id: true, ownerUserId: true },
  });
  if (!dna?.ownerUserId) throw new Error('DNA missing');

  const vault = await prisma.vaultRecord.findUnique({
    where: { dnaRecordId },
    select: { id: true, originalMimeType: true, originalFileName: true },
  });
  if (!vault) throw new Error('Vault missing');

  const pkg = await prisma.spatialAuthPackage.findUnique({
    where: { dnaRecordId },
    select: { width: true, height: true, updatedAt: true, algorithmVersion: true },
  });

  const vaultSvc = new VaultService();
  const retrieved = await vaultSvc.retrieve(vault.id, dna.ownerUserId);
  const vaultBuf = retrieved.originalBuffer;
  const vaultHash = crypto.createHash('sha256').update(vaultBuf).digest('hex');
  const vaultDecoded = await decodeImageForSpatialAuth(vaultBuf);

  console.log('PACKAGE', pkg);
  console.log('VAULT', {
    vaultId: vault.id,
    bytes: vaultBuf.length,
    mime: retrieved.mimeType ?? vault.originalMimeType,
    sha256: vaultHash.slice(0, 16),
    decoded: `${vaultDecoded.width}x${vaultDecoded.height}`,
  });

  const self = await verifyExactSpatialAuthForDna({
    dnaRecordId,
    candidateImageBuffer: vaultBuf,
  });
  console.log('SELF_VERIFY', {
    status: self.status,
    matched: self.matched,
    tampered: self.tampered,
    blocksFailed: self.blocksFailed,
    blocksPassed: self.blocksPassed,
    blocksChecked: self.blocksChecked,
    detail: self.detail?.slice(0, 120),
  });

  if (probePath) {
    const abs = path.resolve(probePath);
    const probeBuf = fs.readFileSync(abs);
    const probeHash = crypto.createHash('sha256').update(probeBuf).digest('hex');
    const probeDecoded = await decodeImageForSpatialAuth(probeBuf);
    const probe = await verifyExactSpatialAuthForDna({
      dnaRecordId,
      candidateImageBuffer: probeBuf,
    });
    console.log('PROBE', {
      path: abs,
      bytes: probeBuf.length,
      sha256: probeHash.slice(0, 16),
      sameBytesAsVault: probeHash === vaultHash,
      decoded: `${probeDecoded.width}x${probeDecoded.height}`,
      dimMatch: probeDecoded.width === vaultDecoded.width && probeDecoded.height === vaultDecoded.height,
    });
    console.log('PROBE_VERIFY', {
      status: probe.status,
      matched: probe.matched,
      tampered: probe.tampered,
      blocksFailed: probe.blocksFailed,
      blocksPassed: probe.blocksPassed,
      fineFailed: probe.fineLocalization?.stats.cellsFailed,
      pixel1Failed: probe.pixel1Localization?.stats.pixelsFailed,
      detail: probe.detail?.slice(0, 160),
    });
  }

  await prisma.$disconnect();
}

main().catch(async (e) => {
  console.error(e);
  await prisma.$disconnect();
  process.exit(1);
});
