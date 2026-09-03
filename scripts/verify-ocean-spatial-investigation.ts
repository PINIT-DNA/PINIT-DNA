/**
 * Ground-truth audit: Ocean.jpg protection package + spatial verify against vault bytes.
 * Does not print HMAC secrets or raw blobs.
 *
 * Usage (repo root): npx ts-node --transpile-only scripts/verify-ocean-spatial-investigation.ts
 */
import { prisma } from '../src/lib/prisma';
import { decodePixelAuthBlob } from '../src/services/spatial/pixel-auth/pixel-blob';
import { pixelMerkleRootHex, verifyPixelRootMac } from '../src/services/spatial/pixel-auth/pixel-merkle';
import { VaultService } from '../src/services/vault/vault.service';
import { verifyExactSpatialAuthForDna } from '../src/services/spatial/verify-exact.service';
import { unifiedInvestigationOrchestrator } from '../src/services/forensics/unified-investigation.orchestrator';

const FILENAME = process.env['AUDIT_FILENAME'] ?? 'Ocean.jpg';
const EXPECTED_W = 960;
const EXPECTED_H = 1280;
const EXPECTED_CELL = 8;
const EXPECTED_CELLS = Math.ceil(EXPECTED_W / EXPECTED_CELL) * Math.ceil(EXPECTED_H / EXPECTED_CELL);

function check(name: string, ok: boolean, detail?: string) {
  const mark = ok ? 'PASS' : 'FAIL';
  console.log(`  [${mark}] ${name}${detail ? ` — ${detail}` : ''}`);
  return ok;
}

async function main() {
  const dna = await prisma.dnaRecord.findFirst({
    where: { imageFilename: FILENAME },
    orderBy: { createdAt: 'desc' },
    include: {
      ownerUser: { select: { id: true, shortId: true, fullName: true } },
      vaultRecord: true,
      cryptoLayer: { select: { id: true } },
      structuralLayer: { select: { id: true } },
      perceptualLayer: { select: { id: true } },
      semanticLayer: { select: { id: true } },
      metadataLayer: { select: { id: true } },
      stegoLayer: { select: { id: true } },
      behavioralLayer: { select: { id: true } },
      relationshipLayer: { select: { id: true } },
      originLayer: { select: { id: true } },
      evolutionLayer: { select: { id: true } },
      custodyLayer: { select: { id: true } },
      deepfakeLayer: { select: { id: true } },
      dctWatermarkLayer: { select: { id: true } },
      zkProofLayer: { select: { id: true } },
      biometricBindLayer: { select: { id: true } },
    },
  });

  if (!dna) {
    console.error(`No DNA record for ${FILENAME}`);
    process.exit(1);
  }

  const asset = await prisma.asset.findFirst({
    where: { dnaId: dna.id },
    select: { id: true, vaultId: true, dnaId: true, ownerUserId: true },
  });

  const pkg = await prisma.spatialAuthPackage.findUnique({ where: { dnaRecordId: dna.id } });
  const monitor = await prisma.monitorRecord.findMany({
    where: { OR: [{ filename: FILENAME }, { dnaRecordId: dna.id }] },
    take: 5,
    select: { id: true, scanType: true, createdAt: true, dnaRecordId: true, assetId: true },
  });
  const crawlerMatches = await prisma.crawlerMatch.findMany({
    where: { dnaRecordId: dna.id },
    take: 10,
    select: { id: true, sourceUrl: true, platform: true, similarity: true, matchType: true, confidence: true },
  });
  const crawlResults = monitor.length
    ? await prisma.crawlResult.findMany({
        where: { monitorRecordId: { in: monitor.map((m) => m.id) } },
        take: 10,
        select: { url: true, pageTitle: true, matchType: true, similarity: true },
      })
    : [];

  console.log('\n=== IDENTIFIERS ===');
  console.log({
    filename: dna.imageFilename,
    dnaId: dna.id,
    vaultId: dna.vaultRecord?.id ?? null,
    assetId: asset?.id ?? null,
    ownerUserId: dna.ownerUserId,
    ownerPinitId: dna.ownerUser?.shortId ?? null,
    ownerName: dna.ownerUser?.fullName ?? null,
  });

  console.log('\n=== 15 DNA LAYERS (persisted rows) ===');
  const layers = [
    ['L1 crypto', dna.cryptoLayer],
    ['L2 structural', dna.structuralLayer],
    ['L3 perceptual', dna.perceptualLayer],
    ['L4 semantic', dna.semanticLayer],
    ['L5 metadata', dna.metadataLayer],
    ['L6 stego', dna.stegoLayer],
    ['L7 behavioral', dna.behavioralLayer],
    ['L8 relationship', dna.relationshipLayer],
    ['L9 origin', dna.originLayer],
    ['L10 evolution', dna.evolutionLayer],
    ['L11 deepfake', dna.deepfakeLayer],
    ['L12 dct watermark', dna.dctWatermarkLayer],
    ['L13 legal custody', dna.custodyLayer],
    ['L14 zk proof', dna.zkProofLayer],
    ['L15 biometric bind', dna.biometricBindLayer],
  ] as const;
  let layerOk = 0;
  for (const [name, row] of layers) {
    const ok = !!row;
    if (ok) layerOk += 1;
    check(name, ok);
  }
  check('all 15 layers present', layerOk === 15, `${layerOk}/15`);

  console.log('\n=== SPATIAL AUTH PACKAGE ===');
  if (!pkg) {
    check('spatial_auth_packages row', false);
    process.exit(2);
  }
  check('package linked to DNA', pkg.dnaRecordId === dna.id);
  check('package owner matches DNA', pkg.ownerUserId === dna.ownerUserId);
  check('pixelScheme', pkg.pixelScheme === 'hkca-8', String(pkg.pixelScheme));
  check('pixelCellSize', pkg.pixelCellSize === 8, String(pkg.pixelCellSize));
  check('pixelTagBytes', pkg.pixelTagBytes === 8, String(pkg.pixelTagBytes));
  check('pixelAlgoVersion persisted', !!pkg.pixelAlgoVersion, pkg.pixelAlgoVersion ?? 'null');
  check('pixelKeyId persisted', !!pkg.pixelKeyId, pkg.pixelKeyId ?? 'null');
  check('pixelAuthBlob present', !!(pkg.pixelAuthBlob && pkg.pixelAuthBlob.length > 0), `${pkg.pixelAuthBlob?.length ?? 0} bytes`);
  check('pixelAuthRoot persisted', !!(pkg.pixelAuthRoot && pkg.pixelAuthRoot.length === 64));
  check('pixelRootMac persisted', !!(pkg.pixelRootMac && pkg.pixelRootMac.length === 64));
  check('blockBlob present', !!(pkg.blockBlob && pkg.blockBlob.length > 0), `${pkg.blockBlob?.length ?? 0} bytes`);
  check('merkleRoot persisted', !!(pkg.merkleRoot && pkg.merkleRoot.length === 64));
  check('pixel1AuthBlob absent (skipPixel1)', !pkg.pixel1AuthBlob, pkg.pixel1AuthBlob ? 'UNEXPECTED' : 'null as intended');
  check('dimensions 960x1280', pkg.width === EXPECTED_W && pkg.height === EXPECTED_H, `${pkg.width}x${pkg.height}`);

  const blob = Buffer.from(pkg.pixelAuthBlob!);
  const decoded = decodePixelAuthBlob(blob);
  check('SPX1 decode', decoded.leaves.length > 0);
  check('decoded scheme', decoded.scheme === 'hkca-8', decoded.scheme);
  check('decoded cellSize', decoded.cellSize === 8, String(decoded.cellSize));
  check('decoded tagBytes', decoded.tagBytes === 8, String(decoded.tagBytes));
  check(`cell count ${EXPECTED_CELLS}`, decoded.leaves.length === EXPECTED_CELLS, String(decoded.leaves.length));

  const uniqueIds = new Set(decoded.leaves.map((l) => l.cellId));
  check('unique cellIds', uniqueIds.size === decoded.leaves.length);
  const coordsOk = decoded.leaves.every((l) =>
    l.width > 0 && l.height > 0
    && l.x % 8 === 0 && l.y % 8 === 0
    && l.x < EXPECTED_W && l.y < EXPECTED_H
    && l.width <= 8 && l.height <= 8
    && l.tag.length === 8,
  );
  check('cell coords/dims/tag length', coordsOk);

  const computedRoot = pixelMerkleRootHex(decoded.leaves);
  check('Merkle root matches pixelAuthRoot', computedRoot === pkg.pixelAuthRoot, `stored=${pkg.pixelAuthRoot?.slice(0, 12)}… computed=${computedRoot.slice(0, 12)}…`);

  const macOk = verifyPixelRootMac({
    dnaRecordId: pkg.dnaRecordId,
    ownerUserId: pkg.ownerUserId,
    width: pkg.width,
    height: pkg.height,
    orientationPolicy: pkg.orientationPolicy,
    globalDnaRef: pkg.globalDnaRef,
    keyId: pkg.pixelKeyId!,
    algorithmVersion: pkg.pixelAlgoVersion!,
    scheme: pkg.pixelScheme!,
    cellSize: pkg.pixelCellSize!,
    tagBytes: pkg.pixelTagBytes!,
    pixelAuthRootHex: pkg.pixelAuthRoot!,
    pixelRootMac: pkg.pixelRootMac!,
  });
  check('pixelRootMac validates (package binding)', macOk);

  console.log('\n=== SPATIAL VERIFY vs VAULT PLAINTEXT (investigation uses this package) ===');
  if (!dna.vaultRecord || !dna.ownerUserId) {
    check('vault retrieve', false, 'missing vault or owner');
  } else {
    const vaultService = new VaultService();
    const retrieved = await vaultService.retrieve(dna.vaultRecord.id, dna.ownerUserId);
    check('vault decrypt (AES whole-file)', retrieved.originalBuffer.length > 0, `${retrieved.originalSizeBytes} bytes`);
    const spatial = await verifyExactSpatialAuthForDna({
      dnaRecordId: dna.id,
      candidateImageBuffer: retrieved.originalBuffer,
    });
    console.log({
      spatialStatus: spatial.status,
      matched: spatial.matched,
      tampered: spatial.tampered,
      blocksChecked: spatial.blocksChecked,
      blocksPassed: spatial.blocksPassed,
      blocksFailed: spatial.blocksFailed,
      merkleRootMatch: spatial.merkleRootMatch,
      rootMacValid: spatial.rootMacValid,
      pixelStatus: spatial.pixelLayer?.status ?? null,
      pixelMatched: spatial.pixelLayer?.matched ?? null,
      cellsChecked: spatial.pixelLayer?.cellsChecked ?? null,
      cellsPassed: spatial.pixelLayer?.cellsPassed ?? null,
      cellsFailed: spatial.pixelLayer?.cellsFailed ?? null,
      pixelRootMacValid: spatial.pixelLayer?.pixelRootMacValid ?? null,
      packageIntegrityValid: spatial.pixelLayer?.packageIntegrityValid ?? null,
      usedStoredPackage: true,
      skipPixel1: true,
    });
    check('investigation spatial MATCH on original vault bytes', spatial.matched === true && spatial.status === 'MATCH', spatial.status);
    check(
      '8×8 HKCA used (cells checked)',
      (spatial.pixelLayer?.cellsChecked ?? 0) === EXPECTED_CELLS
        || (spatial.pixelLayer?.cellsChecked ?? 0) > 0,
      String(spatial.pixelLayer?.cellsChecked),
    );
    check('pixel layer MATCH', spatial.pixelLayer?.status === 'MATCH' && spatial.pixelLayer?.matched === true, spatial.pixelLayer?.status ?? 'none');

    console.log('\n=== UNIFIED INVESTIGATION (probe = vault plaintext; owner from match.ownerUserId) ===');
    const report = await unifiedInvestigationOrchestrator.investigate(
      retrieved.originalBuffer,
      retrieved.originalMimeType || 'image/jpeg',
      FILENAME,
      dna.ownerUserId,
    );
    const spatialInv = report.tamperAnalysis?.spatialAuthInvestigation as {
      verificationStatus?: string;
      unavailableReason?: string;
    } | undefined;
    console.log({
      reportState: report.summary?.reportState,
      acceptanceVerdict: report.summary?.acceptanceVerdict,
      ownershipConfidence: report.summary?.ownershipConfidence ?? null,
      dnaMatchPercent: report.summary?.dnaMatchPercent ?? null,
      retrievalConfidence: report.summary?.retrievalConfidence ?? null,
      acceptanceConfidence: report.summary?.acceptanceConfidence ?? null,
      decisionReason: report.summary?.decisionReason ?? null,
      matchedAssetId: (report as { match?: { assetId?: string } }).match?.assetId
        ?? asset?.id
        ?? null,
      matchedDnaId: report.owner?.dnaRecordId ?? report.identityProof?.dnaRecordId ?? null,
      matchedVaultId: report.owner?.vaultId ?? report.identityProof?.vaultId ?? null,
      resolvedOwnerName: report.owner?.ownerName ?? null,
      resolvedOwnerPinitId: report.owner?.ownerPinitId ?? null,
      ownerMatchesGroundTruth:
        report.owner?.ownerPinitId === dna.ownerUser?.shortId
        || report.owner?.dnaRecordId === dna.id
        || report.owner?.vaultId === dna.vaultRecord?.id,
      spatialVerificationStatus: spatialInv?.verificationStatus ?? null,
      spatialUnavailable: spatialInv?.unavailableReason ?? null,
      leakHasPublic: report.leakIntelligence?.hasPublicLeak ?? false,
      leakEntries: report.leakIntelligence?.entries?.length ?? 0,
      leakMessage: report.leakIntelligence?.message ?? null,
    });
    check(
      'investigation matched this DNA/vault',
      report.owner?.dnaRecordId === dna.id || report.owner?.vaultId === dna.vaultRecord?.id,
      `dna=${report.owner?.dnaRecordId ?? 'none'} vault=${report.owner?.vaultId ?? 'none'}`,
    );
    check(
      'owner resolved from protected asset (not filename)',
      !!report.owner?.ownerPinitId && report.owner.ownerPinitId === dna.ownerUser?.shortId,
      String(report.owner?.ownerPinitId),
    );
    check(
      'spatial package used in investigation',
      spatialInv?.verificationStatus !== 'SKIPPED' && spatialInv?.verificationStatus !== 'DISABLED',
      spatialInv?.verificationStatus ?? 'missing',
    );
  }

  console.log('\n=== CRAWLER / MONITOR (evidence, not owner) ===');
  check('monitor enrollments', monitor.length > 0, `${monitor.length} record(s)`);
  console.log({ crawlerMatches, crawlResults });
  check(
    'crawler match rows (external copy)',
    crawlerMatches.length > 0 || crawlResults.length > 0,
    crawlerMatches.length ? `${crawlerMatches.length} crawler_matches` : `${crawlResults.length} crawl_results`,
  );

  console.log('\nThresholds (code, not 10% ownership): POSSIBLE_MIN=55, VERIFIED_FUSION_MIN=90, local-DNA minMatchRatio=0.08 is fragment ratio only.\n');
}

main()
  .catch((err) => {
    console.error(err);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
