/**
 * PINIT-DNA — AES-256-GCM Encryption Service
 *
 * Provides encrypt / decrypt for vault storage.
 *
 * Key derivation:
 *   Key = HKDF-SHA256(masterSecret, salt=vaultId, info='pinit-dna-vault-v1', 32 bytes)
 *   The derived key is NEVER stored anywhere — it is re-derived at retrieval time
 *   using only the vaultId (stored in the DB) and the masterSecret (in .env).
 *
 * Encrypted file format (written to disk):
 *   ┌─────────────────────────────────────────────────────────────┐
 *   │  Bytes 0–11   (12)  │  IV (random, unique per file)         │
 *   │  Bytes 12–27  (16)  │  GCM Auth Tag                         │
 *   │  Bytes 28–end       │  AES-256-GCM ciphertext               │
 *   └─────────────────────────────────────────────────────────────┘
 *
 * The auth tag is prepended (not appended) so we can read it without
 * knowing the plaintext length upfront.
 */

import crypto from 'crypto';
import { config } from '../../config';

const ALGORITHM   = 'aes-256-gcm';
const KEY_BYTES   = 32;   // 256 bits
const IV_BYTES    = 12;   // 96-bit IV recommended for GCM
const TAG_BYTES   = 16;   // 128-bit auth tag
const HKDF_INFO   = Buffer.from('pinit-dna-vault-v1');
const HEADER_SIZE = IV_BYTES + TAG_BYTES; // 28 bytes

export interface EncryptResult {
  encryptedBuffer: Buffer;  // full file: [IV][Tag][Ciphertext]
  ivHex: string;
  authTagHex: string;
  originalSizeBytes: number;
  encryptedSizeBytes: number;
}

/**
 * Derive a deterministic 256-bit AES key for a given vaultId.
 * Uses HKDF-SHA256 so the master secret is never used directly as a key.
 */
function deriveKey(vaultId: string): Buffer {
  return Buffer.from(crypto.hkdfSync(
    'sha256',
    Buffer.from(config.vault.masterSecret, 'utf8'),  // IKM
    Buffer.from(vaultId, 'utf8'),                     // salt  (unique per vault)
    HKDF_INFO,                                        // context info
    KEY_BYTES
  ));
}

/**
 * Encrypt a buffer using AES-256-GCM.
 * The original buffer (plaintext) is never written to disk — only the result.
 *
 * @param plaintext  — raw image bytes (original file)
 * @param vaultId    — used as HKDF salt to derive the encryption key
 */
export function encrypt(plaintext: Buffer, vaultId: string): EncryptResult {
  const key = deriveKey(vaultId);
  const iv  = crypto.randomBytes(IV_BYTES);

  const cipher = crypto.createCipheriv(ALGORITHM, key, iv, {
    authTagLength: TAG_BYTES,
  });

  const ciphertext = Buffer.concat([cipher.update(plaintext), cipher.final()]);
  const authTag    = cipher.getAuthTag();

  // Layout: [IV (12)] [AuthTag (16)] [Ciphertext (N)]
  const encryptedBuffer = Buffer.concat([iv, authTag, ciphertext]);

  return {
    encryptedBuffer,
    ivHex:             iv.toString('hex'),
    authTagHex:        authTag.toString('hex'),
    originalSizeBytes: plaintext.length,
    encryptedSizeBytes: encryptedBuffer.length,
  };
}

/**
 * Decrypt a vault file back to the original image bytes.
 *
 * @param encryptedBuffer — full vault file [IV][Tag][Ciphertext]
 * @param vaultId         — used to re-derive the key via HKDF
 */
export function decrypt(encryptedBuffer: Buffer, vaultId: string): Buffer {
  if (encryptedBuffer.length <= HEADER_SIZE) {
    throw new Error('Vault file is too small — corrupted or invalid');
  }

  const key        = deriveKey(vaultId);
  const iv         = encryptedBuffer.subarray(0, IV_BYTES);
  const authTag    = encryptedBuffer.subarray(IV_BYTES, HEADER_SIZE);
  const ciphertext = encryptedBuffer.subarray(HEADER_SIZE);

  const decipher = crypto.createDecipheriv(ALGORITHM, key, iv, {
    authTagLength: TAG_BYTES,
  });
  decipher.setAuthTag(authTag);

  // If the auth tag is invalid (tampered file), this throws
  return Buffer.concat([decipher.update(ciphertext), decipher.final()]);
}
