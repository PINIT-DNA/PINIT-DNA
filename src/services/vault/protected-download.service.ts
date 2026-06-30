/**
 * Protected Download — owner vault export with DNA + certificate verification.
 * Returns decrypted bytes unchanged (forensic identity embedded at vault store time).
 */
import crypto from 'crypto';
import { prisma } from '../../lib/prisma';
import { logger } from '../../lib/logger';
import { VaultService } from './vault.service';
import { certificateService } from '../certificates/certificate.service';
import { identityEmbeddingService } from '../identity/identity-embedding.service';
import { assertRecordOwner } from '../../lib/tenant-scope';
import { vaultDownloadIdentityService } from './vault-download-identity.service';

function flag(key: string, defaultValue = true): boolean {
  const v = (process.env[key] ?? '').trim().toLowerCase();
  if (!v) return defaultValue;
  return v === '1' || v === 'true' || v === 'yes';
}

export const protectedDownloadConfig = {
  enabled: flag('PROTECTED_DOWNLOAD_ENABLED', true),
};

export type ProtectedDownloadStepId =
  | 'ownership'
  | 'decrypt'
  | 'dna'
  | 'certificate'
  | 'identity'
  | 'identity_token'
  | 'prepare';

export interface ProtectedDownloadStep {
  id: ProtectedDownloadStepId;
  label: string;
  status: 'pending' | 'running' | 'complete' | 'warning' | 'failed';
  detail?: string;
}

export interface ProtectedDownloadResult {
  buffer: Buffer;
  originalFileName: string;
  originalMimeType: string;
  vaultId: string;
  dnaRecordId: string;
  certificateId: string | null;
  ownerUserId: string | null;
  ownerShortId: string | null;
  fileSha256: string;
  steps: ProtectedDownloadStep[];
  forensicPreserved: boolean;
  identityTokenEmbedded?: boolean;
  watermarkMethod?: string;
}

export class ProtectedDownloadService {
  private readonly vault = new VaultService();

  async prepare(vaultId: string, requestingUserId: string): Promise<ProtectedDownloadResult> {
    if (!protectedDownloadConfig.enabled) {
      throw new Error('Protected Download is disabled');
    }

    const steps: ProtectedDownloadStep[] = [];

    const record = await prisma.vaultRecord.findUnique({
      where: { id: vaultId },
      include: {
        dnaRecord: {
          select: {
            id: true,
            status: true,
            ownerUserId: true,
            sha256Hash: true,
            ownerUser: { select: { id: true, shortId: true } },
          },
        },
      },
    });

    if (!record) throw new Error(`Vault record not found: ${vaultId}`);

    assertRecordOwner(record.dnaRecord?.ownerUserId, requestingUserId, 'Vault');
    steps.push({
      id: 'ownership',
      label: 'Ownership verified',
      status: 'complete',
      detail: 'Authenticated owner confirmed',
    });

    const retrieved = await this.vault.retrieve(vaultId, requestingUserId);
    steps.push({
      id: 'decrypt',
      label: 'Vault decrypted (AES-256-GCM)',
      status: 'complete',
      detail: 'Authentication tag valid — file integrity intact in vault',
    });

    const buffer = retrieved.originalBuffer;
    const fileSha256 = crypto.createHash('sha256').update(buffer).digest('hex');

    const dnaStatus = record.dnaRecord?.status ?? 'UNKNOWN';
    const dnaOk = dnaStatus === 'COMPLETE' || dnaStatus === 'PARTIAL';
    steps.push({
      id: 'dna',
      label: dnaOk ? 'DNA record verified' : 'DNA record incomplete',
      status: dnaOk ? 'complete' : 'warning',
      detail: dnaOk
        ? `DNA record ${record.dnaRecordId} — ${dnaStatus}`
        : `DNA status is ${dnaStatus} — download allowed with caution`,
    });

    const cert = await prisma.certificate.findFirst({
      where: { vaultId, dnaRecordId: record.dnaRecordId, status: 'ACTIVE' },
      orderBy: { issuedAt: 'desc' },
    });

    let certificateId: string | null = null;
    if (cert) {
      const verification = await certificateService.verify(cert.certificateId);
      if (!verification.valid) {
        steps.push({
          id: 'certificate',
          label: 'Certificate invalid',
          status: 'failed',
          detail: verification.detail,
        });
        throw new Error(`Certificate verification failed: ${verification.detail}`);
      }
      certificateId = cert.certificateId;
      steps.push({
        id: 'certificate',
        label: 'Certificate verified',
        status: 'complete',
        detail: verification.detail,
      });
    } else {
      steps.push({
        id: 'certificate',
        label: 'No certificate on file',
        status: 'warning',
        detail: 'Download proceeds — issue a certificate from Certificates for full legal chain',
      });
    }

    const identity = await identityEmbeddingService.extractAndVerify(
      buffer,
      retrieved.originalMimeType,
      retrieved.originalFileName,
    );

    const forensicPreserved = identity.found && identity.valid;
    steps.push({
      id: 'identity',
      label: forensicPreserved ? 'Forensic identity preserved' : 'Identity markers',
      status: forensicPreserved ? 'complete' : 'warning',
      detail: forensicPreserved
        ? `Embedded identity verified — Vault ${identity.vaultId?.slice(0, 8)}… DNA ${identity.dnaId?.slice(0, 8)}…`
        : 'Identity embedding not detected in file — DNA layers in registry still apply for Compare',
    });

    let outBuffer = buffer;
    let identityTokenEmbedded = false;
    let watermarkMethod: string | undefined;

    const ownerId = record.dnaRecord?.ownerUserId ?? requestingUserId;
    const embedded = await vaultDownloadIdentityService.embedForDownload(
      outBuffer,
      retrieved.originalMimeType,
      retrieved.originalFileName,
      vaultId,
      record.dnaRecordId,
      ownerId,
    );
    outBuffer = embedded.buffer;
    identityTokenEmbedded = embedded.identityEmbedded;
    watermarkMethod = embedded.methods.join(', ') || undefined;

    if (identityTokenEmbedded) {
      steps.push({
        id: 'identity_token',
        label: 'Forensic identity embedded',
        status: 'complete',
        detail: embedded.detail,
      });
    } else {
      steps.push({
        id: 'identity_token',
        label: 'Identity embedding',
        status: 'warning',
        detail: embedded.detail,
      });
    }

    steps.push({
      id: 'prepare',
      label: 'Protected file ready',
      status: 'complete',
      detail: identityTokenEmbedded
        ? 'Encrypted identity token embedded — forensic DNA registry intact'
        : 'File bytes unchanged — watermarks, DNA fingerprints, and embedded identity intact',
    });

    logger.info('Protected download prepared', {
      vaultId,
      dnaRecordId: record.dnaRecordId,
      certificateId,
      forensicPreserved,
      fileSha256: fileSha256.slice(0, 16),
    });

    return {
      buffer: outBuffer,
      originalFileName: retrieved.originalFileName,
      originalMimeType: retrieved.originalMimeType,
      vaultId,
      dnaRecordId: record.dnaRecordId,
      certificateId,
      ownerUserId: record.dnaRecord?.ownerUserId ?? null,
      ownerShortId: record.dnaRecord?.ownerUser?.shortId ?? null,
      fileSha256: crypto.createHash('sha256').update(outBuffer).digest('hex'),
      steps,
      forensicPreserved,
      identityTokenEmbedded,
      watermarkMethod,
    };
  }
}

export const protectedDownloadService = new ProtectedDownloadService();
