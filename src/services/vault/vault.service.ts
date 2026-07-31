/**
 * PINIT-DNA — Vault Service
 *
 * Orchestrates encrypted storage and retrieval of DNA-protected images.
 *
 * Storage flow:
 *   1. Receive original file buffer + dnaRecordId
 *   2. Generate a vaultId (UUID)
 *   3. Run identity embedding pipeline (watermark + signature + manifest)
 *   4. Derive AES-256 key via HKDF(masterSecret, vaultId)
 *   5. Encrypt file → [IV][AuthTag][Ciphertext]
 *   6. Write encrypted file to storage — original is NEVER written
 *   7. Persist vault_records row in DB
 *   8. Return vault metadata
 *
 * Retrieval flow:
 *   1. Load vault_records row by vaultId
 *   2. Read encrypted file from disk
 *   3. Re-derive AES key from vaultId
 *   4. Decrypt → return original image bytes + MIME type
 */

import path from 'path';
import fs   from 'fs/promises';
import { v4 as uuidv4 } from 'uuid';

import { prisma } from '../../lib/prisma';
import { logger } from '../../lib/logger';
import { encrypt, decrypt } from './encryption.service';
import { uploadVaultFile, downloadVaultFile, deleteVaultFile, isSupabaseStorageConfigured } from '../../lib/supabase-storage';
import { assertRecordOwner } from '../../lib/tenant-scope';
import { identityEmbeddingPipeline } from '../identity/identity-embedding-pipeline.service';

// In development without Supabase configured, fall back to local disk.
const USE_LOCAL = process.env['NODE_ENV'] !== 'production' &&
  (!process.env['SUPABASE_URL'] || !process.env['SUPABASE_SERVICE_KEY']);

const LOCAL_DIR = path.resolve(process.env['VAULT_STORAGE_DIR'] ?? './vault/encrypted');

async function writeLocal(vaultId: string, buffer: Buffer): Promise<string> {
  await fs.mkdir(LOCAL_DIR, { recursive: true });
  const filePath = path.join(LOCAL_DIR, `${vaultId}.enc`);
  await fs.writeFile(filePath, buffer);
  return filePath;
}

async function readLocal(vaultId: string): Promise<Buffer> {
  const filePath = path.join(LOCAL_DIR, `${vaultId}.enc`);
  return fs.readFile(filePath);
}

export interface StoreResult {
  vaultId:            string;
  dnaRecordId:        string;
  encryptedFilePath:  string;
  originalFileName:   string;
  originalMimeType:   string;
  encryptedSizeBytes: number;
  originalSizeBytes:  number;
  encryptionAlgorithm: string;
  ivHex:              string;
  authTagHex:         string;
  createdAt:          Date;
  identityEmbedding?: {
    success:           boolean;
    methods:           string[];
    verified:          boolean;
    watermarkEmbedded: boolean;
    signatureEmbedded: boolean;
    manifestEmbedded:  boolean;
    detail:            string;
  };
}

export interface RetrieveResult {
  originalBuffer:    Buffer;
  originalFileName:  string;
  originalMimeType:  string;
  originalSizeBytes: number;
  vaultId:           string;
  dnaRecordId:       string;
}

export class VaultService {

  /**
   * Ensure the vault storage directory exists.
   * Called once at startup or before first write.
   */
  /**
   * Encrypt a file and store it in Supabase Storage (persistent across redeploys).
   * The original buffer is encrypted in-memory and never written to disk.
   */
  async store(params: {
    dnaRecordId:      string;
    ownerUserId:      string;
    imageBuffer:      Buffer;
    originalFileName: string;
    originalMimeType: string;
  }): Promise<StoreResult> {
    const { dnaRecordId, ownerUserId, imageBuffer, originalFileName, originalMimeType } = params;

    logger.info('Vault — storing encrypted file', {
      dnaRecordId,
      originalFileName,
      originalSizeBytes: imageBuffer.length,
    });

    // ── Check DNA record exists ────────────────────────────────────────────
    const dnaRecord = await prisma.dnaRecord.findUnique({ where: { id: dnaRecordId } });
    if (!dnaRecord) throw new Error(`DNA record not found: ${dnaRecordId}`);
    assertRecordOwner(dnaRecord.ownerUserId, ownerUserId, 'DNA record');

    // ── Check not already vaulted ─────────────────────────────────────────
    const existing = await prisma.vaultRecord.findUnique({ where: { dnaRecordId } });
    if (existing) throw new Error(`DNA record ${dnaRecordId} is already in the vault`);

    // ── Embed owner identity into file before encryption ──────────────────
    // Embeds DNA ID + Vault ID + Owner User ID as a cryptographic signature
    // inside the file itself. Even if 90% of the file is tampered, this
    // signature allows us to prove original ownership and detect the culprit.
    const vaultId = uuidv4();
    const certificateId = await identityEmbeddingPipeline.resolveCertificateId(dnaRecordId);

    let fileToEncrypt = imageBuffer;
    let embedAudit: StoreResult['identityEmbedding'];

    try {
      const pipelineResult = await identityEmbeddingPipeline.process(
        imageBuffer,
        originalMimeType,
        originalFileName,
        {
          vaultId,
          dnaRecordId,
          ownerUserId: dnaRecord.ownerUserId ?? ownerUserId,
          certificateId,
        },
      );

      if (pipelineResult.success) {
        fileToEncrypt = pipelineResult.buffer;
      }

      embedAudit = {
        success: pipelineResult.success,
        methods: pipelineResult.methods,
        verified: pipelineResult.verified,
        watermarkEmbedded: pipelineResult.watermarkEmbedded,
        signatureEmbedded: pipelineResult.signatureEmbedded,
        manifestEmbedded: pipelineResult.manifestEmbedded,
        detail: pipelineResult.detail,
      };

      logger.info('Vault — identity pipeline complete', {
        vaultId,
        dnaRecordId,
        methods: pipelineResult.methods,
        verified: pipelineResult.verified,
      });
    } catch (embedErr) {
      logger.warn('Vault — identity pipeline failed (proceeding without)', { error: embedErr });
      embedAudit = {
        success: false,
        methods: [],
        verified: false,
        watermarkEmbedded: false,
        signatureEmbedded: false,
        manifestEmbedded: false,
        detail: 'Pipeline failed — stored without embedded identity',
      };
    }

    // ── Encrypt in-memory ─────────────────────────────────────────────────
    const encResult = encrypt(fileToEncrypt, vaultId);

    // ── Store encrypted file (local in dev, Supabase in production) ──────
    let encryptedFilePath: string;
    if (USE_LOCAL) {
      encryptedFilePath = await writeLocal(vaultId, encResult.encryptedBuffer);
      logger.debug('Vault — stored locally', { vaultId, encryptedFilePath });
    } else {
      encryptedFilePath = await uploadVaultFile(vaultId, encResult.encryptedBuffer, ownerUserId);
      logger.debug('Vault — uploaded to Supabase Storage', { vaultId, encryptedFilePath });
    }

    // ── Persist vault record ───────────────────────────────────────────────
    const record = await prisma.vaultRecord.create({
      data: {
        id:                 vaultId,
        dnaRecordId,
        encryptedFilePath,
        originalFileName,
        originalMimeType,
        encryptedSizeBytes: encResult.encryptedSizeBytes,
        originalSizeBytes:  encResult.originalSizeBytes,
        encryptionAlgorithm: 'AES-256-GCM',
        keyDerivation:      'HKDF-SHA256',
        ivHex:              encResult.ivHex,
        authTagHex:         encResult.authTagHex,
      },
    });

    logger.info('Vault — storage complete', { vaultId, dnaRecordId });

    try {
      const { forensicProvenanceService } = await import('../forensics/forensic-provenance.service');
      forensicProvenanceService.appendAsync({
        eventType: 'ENCRYPTED',
        summary: `Encrypted — AES-256-GCM`,
        dnaRecordId,
        vaultId,
        payload: { algorithm: 'AES-256-GCM' },
        dedupeKey: `encrypted:${vaultId}`,
      });
      forensicProvenanceService.appendAsync({
        eventType: 'VAULT_STORED',
        summary: `Stored in vault — ${originalFileName}`,
        dnaRecordId,
        vaultId,
        actorUserId: ownerUserId,
        payload: {
          originalSizeBytes: record.originalSizeBytes,
          encryptedSizeBytes: record.encryptedSizeBytes,
        },
        dedupeKey: `vault_stored:${vaultId}`,
      });
    } catch {
      /* non-fatal */
    }

    import('../platform-events/module-events').then(({ emitVaultStored }) => {
      emitVaultStored({
        ownerUserId,
        vaultId,
        dnaRecordId,
        filename: originalFileName,
      });
    }).catch(() => {});

    return {
      vaultId:            record.id,
      dnaRecordId:        record.dnaRecordId,
      encryptedFilePath:  record.encryptedFilePath,
      originalFileName:   record.originalFileName,
      originalMimeType:   record.originalMimeType,
      encryptedSizeBytes: record.encryptedSizeBytes,
      originalSizeBytes:  record.originalSizeBytes,
      encryptionAlgorithm: record.encryptionAlgorithm,
      ivHex:              record.ivHex,
      authTagHex:         record.authTagHex,
      createdAt:          record.createdAt,
      identityEmbedding:  embedAudit,
    };
  }

  /**
   * Get vault record metadata (no file content).
   */
  async getRecord(vaultId: string) {
    const record = await prisma.vaultRecord.findUnique({
      where: { id: vaultId },
      include: {
        dnaRecord: {
          select: { id: true, status: true, schemaVersion: true, imageFilename: true },
        },
      },
    });
    if (!record) throw new Error(`Vault record not found: ${vaultId}`);
    return record;
  }

  /**
   * Retrieve and decrypt a vaulted image.
   * Reads the encrypted file, decrypts it in-memory, returns original bytes.
   * If the auth tag is invalid (file tampered), AES-GCM will throw automatically.
   */
  async retrieve(vaultId: string, requestingUserId?: string): Promise<RetrieveResult> {
    logger.info('Vault — retrieving encrypted image', { vaultId });

    const record = await prisma.vaultRecord.findUnique({
      where: { id: vaultId },
      include: { dnaRecord: { select: { ownerUserId: true } } },
    });
    if (!record) throw new Error(`Vault record not found: ${vaultId}`);
    if (requestingUserId) {
      assertRecordOwner(record.dnaRecord?.ownerUserId, requestingUserId, 'Vault');
    }
    const ownerUserId = record.dnaRecord?.ownerUserId ?? undefined;

    // ── Download encrypted file (local in dev, Supabase in production) ──
    let encryptedBuffer: Buffer;
    try {
      if (USE_LOCAL) {
        encryptedBuffer = await readLocal(vaultId);
      } else {
        encryptedBuffer = await downloadVaultFile(
          vaultId,
          ownerUserId,
          record.encryptedFilePath ? [record.encryptedFilePath] : [],
        );
      }
    } catch (err) {
      throw new Error(`Vault file unavailable: ${String(err)}`);
    }

    // ── Decrypt (key re-derived from vaultId + master secret) ─────────────
    let originalBuffer: Buffer;
    try {
      originalBuffer = decrypt(encryptedBuffer, vaultId);
    } catch (err) {
      const detail = (err as Error).message ?? String(err);
      throw new Error(
        `Vault decrypt failed for ${vaultId}: ${detail}. `
        + 'Ensure VAULT_MASTER_SECRET on the server matches the key used when this file was vaulted.',
      );
    }

    logger.info('Vault — retrieval complete', {
      vaultId,
      originalSizeBytes: originalBuffer.length,
    });

    return {
      originalBuffer,
      originalFileName:  record.originalFileName,
      originalMimeType:  record.originalMimeType,
      originalSizeBytes: record.originalSizeBytes,
      vaultId,
      dnaRecordId:       record.dnaRecordId,
    };
  }

  /**
   * Remove encrypted file from storage and delete the vault record.
   * DNA record is retained for audit; share links for this vault are deactivated.
   * DB row is deleted first so the UI can update immediately; storage cleanup is best-effort after.
   */
  async delete(vaultId: string, ownerUserId: string): Promise<{ vaultId: string; dnaRecordId: string }> {
    const record = await prisma.vaultRecord.findUnique({
      where: { id: vaultId },
      include: { dnaRecord: { select: { ownerUserId: true, id: true } } },
    });
    if (!record) throw new Error(`Vault record not found: ${vaultId}`);
    assertRecordOwner(record.dnaRecord?.ownerUserId, ownerUserId, 'Vault');

    const storageOwner = record.dnaRecord?.ownerUserId ?? ownerUserId;
    const encryptedFilePath = record.encryptedFilePath;
    const dnaRecordId = record.dnaRecordId;
    const originalFileName = record.originalFileName;

    await prisma.shareLink.updateMany({
      where: { vaultId },
      data: { isActive: false },
    });

    // Remove DB row first — client list updates as soon as this returns
    await prisma.vaultRecord.delete({ where: { id: vaultId } });

    // Storage cleanup after DB delete (do not block the API response on slow Supabase I/O)
    void (async () => {
      try {
        if (USE_LOCAL) {
          await fs.unlink(path.join(LOCAL_DIR, `${vaultId}.enc`)).catch(() => {});
        } else if (isSupabaseStorageConfigured()) {
          await deleteVaultFile(vaultId, {
            ownerUserId: storageOwner,
            storedPath: encryptedFilePath,
          });
        }
      } catch (err) {
        logger.warn('Vault — storage cleanup failed after DB delete', { vaultId, error: String(err) });
      }
    })();

    try {
      const { aiService } = await import('../ai/ai-embeddings.service');
      void aiService.removeFromIndex(dnaRecordId).catch(() => {});
    } catch {
      /* non-fatal */
    }

    try {
      const { forensicProvenanceService } = await import('../forensics/forensic-provenance.service');
      forensicProvenanceService.appendAsync({
        eventType: 'VAULT_DELETED',
        summary: `Removed from vault — ${originalFileName}`,
        dnaRecordId,
        vaultId,
        actorUserId: ownerUserId,
        dedupeKey: `vault_deleted:${vaultId}`,
      });
    } catch {
      /* non-fatal */
    }

    logger.info('Vault — record deleted', { vaultId, dnaRecordId });

    import('../platform-events/module-events').then(({ emitVaultDeleted }) => {
      emitVaultDeleted({
        ownerUserId,
        vaultId,
        dnaRecordId,
        filename: originalFileName,
      });
    }).catch(() => {});

    return { vaultId, dnaRecordId };
  }

  /** Update display name only — encrypted bytes and DNA hashes are unchanged. */
  async rename(
    vaultId: string,
    ownerUserId: string,
    newFileName: string,
  ): Promise<{ vaultId: string; originalFileName: string }> {
    const trimmed = newFileName.trim();
    if (!trimmed || trimmed.length > 255) {
      throw new Error('Invalid file name');
    }
    if (/[<>:"/\\|?*\u0000-\u001f]/.test(trimmed)) {
      throw new Error('File name contains invalid characters');
    }

    const record = await prisma.vaultRecord.findUnique({
      where: { id: vaultId },
      include: { dnaRecord: { select: { ownerUserId: true, id: true } } },
    });
    if (!record) throw new Error(`Vault record not found: ${vaultId}`);
    assertRecordOwner(record.dnaRecord?.ownerUserId, ownerUserId, 'Vault');

    if (trimmed === record.originalFileName) {
      return { vaultId, originalFileName: trimmed };
    }

    await prisma.$transaction([
      prisma.vaultRecord.update({
        where: { id: vaultId },
        data: { originalFileName: trimmed },
      }),
      prisma.dnaRecord.update({
        where: { id: record.dnaRecordId },
        data: { imageFilename: trimmed },
      }),
    ]);

    logger.info('Vault — file renamed', { vaultId, originalFileName: trimmed });

    return { vaultId, originalFileName: trimmed };
  }
}
