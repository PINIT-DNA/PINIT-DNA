/**
 * DNA storage integrity audit — verifies 15-layer persistence and authoritative linkage.
 * Does NOT modify upload pipeline or thresholds.
 */
import { prisma } from '../../lib/prisma';
import { DNA_LAYER_REGISTRY } from '../../constants/dna-layer-registry';
import { TOTAL_DNA_LAYERS } from '../../constants/dna-layers';
import { parseEnterpriseDnaPackage } from '../dna/enterprise-dna-package.service';
import type {
  AuthoritativeRecordAudit,
  DnaLayerStorageAudit,
  DnaStorageAuditReport,
} from '../../types/investigation-pipeline-audit.types';

const LAYER_TABLE_NAMES: Record<number, string> = {
  1: 'crypto_layers',
  2: 'structural_layers',
  3: 'perceptual_layers',
  4: 'semantic_layers',
  5: 'metadata_layers',
  6: 'stego_layers',
  7: 'behavioral_layers',
  8: 'relationship_layers',
  9: 'origin_layers',
  10: 'evolution_layers',
  11: 'deepfake_layers',
  12: 'dct_watermark_layers',
  13: 'custody_layers',
  14: 'zk_proof_layers',
  15: 'biometric_bind_layers',
};

const LAYER_RELATION_KEYS = [
  'cryptoLayer',
  'structuralLayer',
  'perceptualLayer',
  'semanticLayer',
  'metadataLayer',
  'stegoLayer',
  'behavioralLayer',
  'relationshipLayer',
  'originLayer',
  'evolutionLayer',
  'deepfakeLayer',
  'dctWatermarkLayer',
  'custodyLayer',
  'zkProofLayer',
  'biometricBindLayer',
] as const;

type DnaWithLayers = Awaited<ReturnType<typeof loadRecords>>[number];

function buildLayerDetails(record: DnaWithLayers): DnaLayerStorageAudit[] {
  const jsonLayerCount = countUniversalJsonLayers(record.universalFingerprints);
  const isImage = record.fileType === 'IMAGE' || (record.imageMimeType?.startsWith('image/') ?? false);

  return Array.from({ length: TOTAL_DNA_LAYERS }, (_, i) => {
    const n = i + 1;
    const reg = DNA_LAYER_REGISTRY[n]!;
    if (!isImage && n <= 6 && jsonLayerCount > 0) {
      const stored = n <= jsonLayerCount;
      return {
        layer: n,
        name: reg.name,
        stored,
        tableOrField: stored ? 'dna_records.universalFingerprints.layers' : 'missing',
      };
    }
    const key = LAYER_RELATION_KEYS[n - 1]!;
    const stored = !!(record as Record<string, unknown>)[key];
    return {
      layer: n,
      name: reg.name,
      stored,
      tableOrField: LAYER_TABLE_NAMES[n] ?? 'unknown',
    };
  });
}

function countUniversalJsonLayers(universalFingerprints: unknown): number {
  if (!universalFingerprints || typeof universalFingerprints !== 'object') return 0;
  const layers = (universalFingerprints as { layers?: unknown[] }).layers;
  return Array.isArray(layers) ? layers.filter((l) => l && typeof l === 'object').length : 0;
}

function layerIncludes() {
  return {
    cryptoLayer: true,
    structuralLayer: true,
    perceptualLayer: true,
    semanticLayer: true,
    metadataLayer: true,
    stegoLayer: true,
    behavioralLayer: true,
    relationshipLayer: true,
    originLayer: true,
    evolutionLayer: true,
    deepfakeLayer: true,
    dctWatermarkLayer: true,
    custodyLayer: true,
    zkProofLayer: true,
    biometricBindLayer: true,
    vaultRecord: { select: { id: true, encryptedFilePath: true, originalFileName: true, dnaRecordId: true } },
  };
}

async function loadRecords(ownerUserId: string) {
  return prisma.dnaRecord.findMany({
    where: { ownerUserId },
    include: layerIncludes(),
    orderBy: { createdAt: 'desc' },
  });
}

export class DnaStorageAuditService {
  async auditOwner(ownerUserId: string): Promise<DnaStorageAuditReport> {
    const [records, certs, vaultCount] = await Promise.all([
      loadRecords(ownerUserId),
      prisma.certificate.findMany({
        where: { ownerUserId },
        select: { certificateId: true, dnaRecordId: true, vaultId: true, status: true },
      }),
      prisma.vaultRecord.count({
        where: { dnaRecord: { ownerUserId } },
      }),
    ]);

    const certByDna = new Map(certs.map((c) => [c.dnaRecordId, c]));
    const certByVault = new Map(certs.filter((c) => c.vaultId).map((c) => [c.vaultId!, c]));

    const shaGroups = new Map<string, string[]>();
    for (const r of records) {
      if (!r.sha256Hash) continue;
      const list = shaGroups.get(r.sha256Hash) ?? [];
      list.push(r.id);
      shaGroups.set(r.sha256Hash, list);
    }

    const duplicateSha256Groups = [...shaGroups.entries()]
      .filter(([, ids]) => ids.length > 1)
      .map(([sha256, dnaRecordIds]) => ({ sha256, dnaRecordIds }));

    const dnaIds = new Set(records.map((r) => r.id));
    const orphanDnaWithoutVault = records
      .filter((r) => !r.vaultRecord && r.status === 'COMPLETE')
      .map((r) => r.id);

    const ownerRows = await prisma.user.findUnique({
      where: { id: ownerUserId },
      select: { shortId: true },
    });

    const audited: AuthoritativeRecordAudit[] = [];

    for (const r of records) {
      const layerDetails = buildLayerDetails(r);
      const layersStored = layerDetails.filter((l) => l.stored).length;
      const cert = certByDna.get(r.id) ?? (r.vaultRecord ? certByVault.get(r.vaultRecord.id) : undefined);
      const issues: string[] = [];

      if (layersStored < TOTAL_DNA_LAYERS) {
        issues.push(`Only ${layersStored}/${TOTAL_DNA_LAYERS} DNA layers stored`);
      }
      if (!r.vaultRecord) {
        issues.push('No vault record linked');
      }
      if (r.vaultRecord && r.vaultRecord.dnaRecordId !== r.id) {
        issues.push('Vault DNA FK mismatch');
      }
      if (!r.sha256Hash) {
        issues.push('Missing sha256Hash on DNA record');
      }
      // Milestone B Step 2 — enterprise package SSoT checks (additive)
      const enterprisePkg = parseEnterpriseDnaPackage(r.universalFingerprints);
      if (!enterprisePkg) {
        issues.push('Missing enterpriseDnaPackage (SSoT dual-write)');
      } else {
        if (enterprisePkg.layers.length !== TOTAL_DNA_LAYERS) {
          issues.push(`enterpriseDnaPackage has ${enterprisePkg.layers.length}/${TOTAL_DNA_LAYERS} layers`);
        }
        if (!enterprisePkg.overallIntegrityHash || enterprisePkg.overallIntegrityHash.length !== 64) {
          issues.push('enterpriseDnaPackage missing overallIntegrityHash');
        }
        if (enterprisePkg.storageStatus !== 'SEALED' && enterprisePkg.generationStatus === 'COMPLETE') {
          issues.push('COMPLETE package is not SEALED');
        }
      }
      if (cert && cert.dnaRecordId !== r.id) {
        issues.push(`Certificate ${cert.certificateId} points to different DNA record`);
      }
      if (cert?.vaultId && r.vaultRecord && cert.vaultId !== r.vaultRecord.id) {
        issues.push(`Certificate vaultId ${cert.vaultId} ≠ vault ${r.vaultRecord.id}`);
      }

      audited.push({
        dnaRecordId: r.id,
        vaultId: r.vaultRecord?.id ?? null,
        ownerUserId: r.ownerUserId,
        ownerPinitId: ownerRows?.shortId ?? null,
        certificateId: cert?.certificateId ?? null,
        originalFilename: r.imageFilename,
        storagePath: r.vaultRecord?.encryptedFilePath ?? null,
        sha256Hash: r.sha256Hash,
        status: r.status,
        layersStored,
        layersExpected: TOTAL_DNA_LAYERS,
        layerDetails,
        issues,
      });
    }

    const allVaults = await prisma.vaultRecord.findMany({
      where: { dnaRecord: { ownerUserId } },
      select: { id: true, dnaRecordId: true },
    });
    const orphanVaults = allVaults
      .filter((v) => !dnaIds.has(v.dnaRecordId))
      .map((v) => v.id);

    const globalIssues: string[] = [];
    if (duplicateSha256Groups.length) {
      globalIssues.push(`${duplicateSha256Groups.length} duplicate SHA-256 groups (multiple DNA records per file hash)`);
    }
    if (orphanDnaWithoutVault.length) {
      globalIssues.push(`${orphanDnaWithoutVault.length} COMPLETE DNA records without vault`);
    }
    if (orphanVaults.length) {
      globalIssues.push(`${orphanVaults.length} vault records with broken DNA FK`);
    }

    return {
      auditedAt: new Date().toISOString(),
      ownerUserId,
      schemaSummary: {
        hubTable: 'dna_records',
        layerTables: Object.values(LAYER_TABLE_NAMES),
        vaultTable: 'vault_records',
        certificateTable: 'certificates',
        oneDnaPerVault: orphanVaults.length === 0 && orphanDnaWithoutVault.length === 0,
        oneSha256PerOwner: duplicateSha256Groups.length === 0,
        linkage: {
          dnaRecordId: 'dna_records.id (PK)',
          vaultId: 'vault_records.id (PK) → dna_records.id (FK, unique)',
          certificateId: 'certificates.certificateId → dnaRecordId + vaultId',
          ownerUserId: 'dna_records.ownerUserId → users.id → users.shortId (PINIT ID)',
          originalFilename: 'dna_records.imageFilename + vault_records.originalFileName',
          storagePath: 'vault_records.encryptedFilePath (Supabase Storage)',
        },
      },
      totalDnaRecords: records.length,
      totalVaultRecords: vaultCount,
      totalCertificates: certs.length,
      duplicateSha256Groups,
      orphanVaults,
      orphanDnaWithoutVault,
      records: audited,
      globalIssues,
    };
  }
}

export const dnaStorageAuditService = new DnaStorageAuditService();
