import { isDnaVnextEnabled } from '../../config/dna-vnext';
import { loadStoredBlockDnaManifest } from '../block-dna/store';
import { buildProvenanceRecord, persistProvenanceRecord, sha256Hex } from './provenance';

export async function enrollDnaVnextForVaultImage(params: {
  imageBuffer: Buffer;
  dnaRecordId: string;
  vaultId: string;
  certificateId: string | null;
  mimeType: string;
}): Promise<void> {
  if (!isDnaVnextEnabled()) return;
  const stored = await loadStoredBlockDnaManifest(params.dnaRecordId);
  if (!stored) return;
  const record = buildProvenanceRecord({
    vaultId: params.vaultId,
    dnaRecordId: params.dnaRecordId,
    certificateId: params.certificateId,
    imageHash: sha256Hex(params.imageBuffer),
    format: params.mimeType,
    stored,
  });
  await persistProvenanceRecord(params.dnaRecordId, record);
}
