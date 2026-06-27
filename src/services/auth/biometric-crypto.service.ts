/**
 * Encrypt / decrypt biometric templates at rest (AES-256-GCM).
 * Never store raw embeddings in plaintext.
 */
import crypto from 'crypto';
import { config } from '../../config';

const ALGO = 'aes-256-gcm';
const IV_LEN = 12;
const TAG_LEN = 16;

function deriveKey(): Buffer {
  const secret = config.biometric.encryptionKey;
  return crypto.createHash('sha256').update(secret).digest();
}

export function hashTemplate(values: number[]): string {
  const normalized = JSON.stringify(values.map((v) => Math.round(v * 1e6) / 1e6));
  return crypto.createHash('sha256').update(normalized).digest('hex');
}

export function hashIdentifier(value: string): string {
  return crypto.createHash('sha256').update(value).digest('hex');
}

export function encryptTemplate(values: number[]): { cipher: string; hash: string } {
  const key = deriveKey();
  const iv = crypto.randomBytes(IV_LEN);
  const plaintext = JSON.stringify(values);
  const cipher = crypto.createCipheriv(ALGO, key, iv);
  const encrypted = Buffer.concat([cipher.update(plaintext, 'utf8'), cipher.final()]);
  const tag = cipher.getAuthTag();
  const packed = Buffer.concat([iv, tag, encrypted]).toString('base64');
  return { cipher: packed, hash: hashTemplate(values) };
}

export function decryptTemplate(cipherB64: string): number[] {
  const key = deriveKey();
  const packed = Buffer.from(cipherB64, 'base64');
  const iv = packed.subarray(0, IV_LEN);
  const tag = packed.subarray(IV_LEN, IV_LEN + TAG_LEN);
  const encrypted = packed.subarray(IV_LEN + TAG_LEN);
  const decipher = crypto.createDecipheriv(ALGO, key, iv);
  decipher.setAuthTag(tag);
  const plaintext = Buffer.concat([decipher.update(encrypted), decipher.final()]).toString('utf8');
  return JSON.parse(plaintext) as number[];
}

export function hashSessionToken(token: string): string {
  return crypto.createHash('sha256').update(token).digest('hex');
}
