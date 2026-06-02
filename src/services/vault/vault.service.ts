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

import fs from 'fs/promises';
import path from 'path';
import { v4 as uuidv4 } from 'uuid';

import { prisma } from '../../lib/prisma';
import { logger } from '../../lib/logger';
import { config } from '../../config';
import { encrypt, decrypt } from './encryption.service';

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
  async ensureStorageDir(): Promise<void> {
    await fs.mkdir(config.vault.storageDir, { recursive: true });
  }

  /**
   * Encrypt an image and store it in the vault.
   * The original image buffer is encrypted in-memory and never written to disk.
   */
  async store(params: {
    dnaRecordId:      string;
    imageBuffer:      Buffer;
    originalFileName: string;
    originalMimeType: string;
  }): Promise<StoreResult> {
    const { dnaRecordId, imageBuffer, originalFileName, originalMimeType } = params;

    logger.info('Vault — storing encrypted image', {
      dnaRecordId,
      originalFileName,
      originalSizeBytes: imageBuffer.length,
    });

    // ── Check DNA record exists ────────────────────────────────────────────
    const dnaRecord = await prisma.dnaRecord.findUnique({
      where: { id: dnaRecordId },
    });
    if (!dnaRecord) {
      throw new Error(`DNA record not found: ${dnaRecordId}`);
    }

    // ── Check not already vaulted ─────────────────────────────────────────
    const existing = await prisma.vaultRecord.findUnique({
      where: { dnaRecordId },
    });
    if (existing) {
      throw new Error(`DNA record ${dnaRecordId} is already in the vault`);
    }

    // ── Generate vault ID and encrypt ─────────────────────────────────────
    const vaultId = uuidv4();
    await this.ensureStorageDir();

    const encResult = encrypt(imageBuffer, vaultId);

    // ── Write encrypted file — original bytes never touch disk ────────────
    const encryptedFilePath = path.join(
      config.vault.storageDir,
      `${vaultId}.enc`
    );
    await fs.writeFile(encryptedFilePath, encResult.encryptedBuffer);

    logger.debug('Vault — encrypted file written', {
      vaultId,
      encryptedFilePath,
      encryptedSizeBytes: encResult.encryptedSizeBytes,
    });

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

    // ── Read encrypted file ───────────────────────────────────────────────
    let encryptedBuffer: Buffer;
    try {
      encryptedBuffer = await fs.readFile(record.encryptedFilePath);
    } catch {
      throw new Error(`Encrypted vault file missing: ${record.encryptedFilePath}`);
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
