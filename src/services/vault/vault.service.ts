/**
 * PINIT-DNA — Vault Service
 *
 * Orchestrates encrypted storage and retrieval of DNA-protected images.
 *
 * Storage flow:
 *   1. Receive original image buffer + dnaRecordId
 *   2. Generate a vaultId (UUID)
 *   3. Derive AES-256 key via HKDF(masterSecret, vaultId)
 *   4. Encrypt image → [IV][AuthTag][Ciphertext]
 *   5. Write encrypted file to VAULT_STORAGE_DIR — original is NEVER written
 *   6. Persist vault_records row in DB
 *   7. Return vault metadata
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
import { uploadVaultFile, downloadVaultFile } from '../../lib/supabase-storage';
import { identityEmbeddingService } from '../identity/identity-embedding.service';

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
}

export interface RetrieveResult {
  originalBuffer:    Buffer;
  originalFileName:  string;
  originalMimeType:  string;
  originalSizeBytes: number;
  vaultId:           string;
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
    imageBuffer:      Buffer;
    originalFileName: string;
    originalMimeType: string;
  }): Promise<StoreResult> {
    const { dnaRecordId, imageBuffer, originalFileName, originalMimeType } = params;

    logger.info('Vault — storing encrypted file', {
      dnaRecordId,
      originalFileName,
      originalSizeBytes: imageBuffer.length,
    });

    // ── Check DNA record exists ────────────────────────────────────────────
    const dnaRecord = await prisma.dnaRecord.findUnique({ where: { id: dnaRecordId } });
    if (!dnaRecord) throw new Error(`DNA record not found: ${dnaRecordId}`);

    // ── Check not already vaulted ─────────────────────────────────────────
    const existing = await prisma.vaultRecord.findUnique({ where: { dnaRecordId } });
    if (existing) throw new Error(`DNA record ${dnaRecordId} is already in the vault`);

    // ── Embed owner identity into file before encryption ──────────────────
    // Embeds DNA ID + Vault ID + Owner User ID as a cryptographic signature
    // inside the file itself. Even if 90% of the file is tampered, this
    // signature allows us to prove original ownership and detect the culprit.
    const vaultId = uuidv4();
    let fileToEncrypt = imageBuffer;
    try {
      const embedResult = await identityEmbeddingService.embed(
        imageBuffer,
        originalMimeType,
        originalFileName,
        {
          dnaId:       dnaRecordId,
          vaultId,
          ownerUserId: dnaRecord.ownerUserId ?? 'unknown',
        }
      );
      if (embedResult.success) {
        fileToEncrypt = embedResult.buffer;
        logger.info('Vault — identity embedded', {
          method: embedResult.method,
          dnaRecordId,
          vaultId,
        });
      }
    } catch (embedErr) {
      logger.warn('Vault — identity embedding failed (proceeding without)', { error: embedErr });
    }

    // ── Encrypt in-memory ─────────────────────────────────────────────────
    const encResult = encrypt(fileToEncrypt, vaultId);

    // ── Store encrypted file (local in dev, Supabase in production) ──────
    let encryptedFilePath: string;
    if (USE_LOCAL) {
      encryptedFilePath = await writeLocal(vaultId, encResult.encryptedBuffer);
      logger.debug('Vault — stored locally', { vaultId, encryptedFilePath });
    } else {
      encryptedFilePath = await uploadVaultFile(vaultId, encResult.encryptedBuffer);
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
  async retrieve(vaultId: string): Promise<RetrieveResult> {
    logger.info('Vault — retrieving encrypted image', { vaultId });

    const record = await prisma.vaultRecord.findUnique({
      where: { id: vaultId },
    });
    if (!record) throw new Error(`Vault record not found: ${vaultId}`);

    // ── Download encrypted file (local in dev, Supabase in production) ──
    let encryptedBuffer: Buffer;
    try {
      if (USE_LOCAL) {
        encryptedBuffer = await readLocal(vaultId);
      } else {
        encryptedBuffer = await downloadVaultFile(vaultId);
      }
    } catch (err) {
      throw new Error(`Vault file unavailable: ${String(err)}`);
    }

    // ── Decrypt (key re-derived from vaultId + master secret) ─────────────
    const originalBuffer = decrypt(encryptedBuffer, vaultId);

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
    };
  }
}
