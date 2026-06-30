/**
 * Embeds fresh PINIT identity on every vault download — lifetime traceability.
 * Each export gets watermark + signature + manifest + recovery token (QR-like unique ID).
 */
import crypto from 'crypto';
import { logger } from '../../lib/logger';
import { identityEmbeddingPipeline } from '../identity/identity-embedding-pipeline.service';
import { isVaultIdentityPipelineEnabled } from '../../config/vault-identity';
import { auditService } from '../audit/audit.service';
import type { Request } from 'express';

export interface VaultDownloadEmbedResult {
  buffer: Buffer;
  identityEmbedded: boolean;
  methods: string[];
  downloadHash: string;
  detail: string;
}

export class VaultDownloadIdentityService {
  /**
   * Re-embed forensic identity into decrypted vault bytes before download.
   * Fresh recovery token per download — tracks export generation time in file lifespan.
   */
  async embedForDownload(
    buffer: Buffer,
    mimeType: string,
    fileName: string,
    vaultId: string,
    dnaRecordId: string,
    ownerUserId: string,
    req?: Request,
  ): Promise<VaultDownloadEmbedResult> {
    const certificateId = await identityEmbeddingPipeline.resolveCertificateId(dnaRecordId);

    if (!isVaultIdentityPipelineEnabled()) {
      return {
        buffer,
        identityEmbedded: false,
        methods: [],
        downloadHash: crypto.createHash('sha256').update(buffer).digest('hex'),
        detail: 'Vault identity pipeline disabled — serving decrypted bytes',
      };
    }

    const result = await identityEmbeddingPipeline.process(buffer, mimeType, fileName, {
      vaultId,
      dnaRecordId,
      ownerUserId,
      certificateId,
    });

    const downloadHash = crypto.createHash('sha256').update(result.buffer).digest('hex');

    await auditService.log({
      eventType: 'FILE_DOWNLOADED',
      vaultId,
      dnaRecordId,
      filename: fileName,
      fileType: mimeType,
      detail: {
        identityEmbedded: result.success,
        methods: result.methods,
        downloadHash: downloadHash.slice(0, 16),
        watermarkEmbedded: result.watermarkEmbedded,
        manifestEmbedded: result.manifestEmbedded,
      },
      req,
    });

    logger.info('[VaultDownload] Identity embedded for export', {
      vaultId,
      dnaRecordId,
      methods: result.methods,
      verified: result.verified,
    });

    return {
      buffer: result.buffer,
      identityEmbedded: result.success,
      methods: result.methods,
      downloadHash,
      detail: result.detail,
    };
  }
}

export const vaultDownloadIdentityService = new VaultDownloadIdentityService();
