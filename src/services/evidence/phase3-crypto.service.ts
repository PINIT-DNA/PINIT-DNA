/**
 * Phase 3 — Ed25519 signing + AES-256-GCM encryption utilities.
 */
import crypto from 'crypto';
import { config } from '../../config';

const ED25519_CACHE: { privateKey: crypto.KeyObject; publicKey: crypto.KeyObject } | null = (() => {
  try {
    const pem = process.env.PHASE3_ED25519_PRIVATE_KEY_PEM?.trim();
    if (pem) {
      const privateKey = crypto.createPrivateKey(pem);
      const publicKey = crypto.createPublicKey(privateKey);
      return { privateKey, publicKey };
    }
    const { privateKey, publicKey } = crypto.generateKeyPairSync('ed25519');
    return { privateKey, publicKey };
  } catch {
    return null;
  }
})();

function signingSecret(): string {
  return process.env.PHASE3_SIGNING_SECRET ?? config.vault.masterSecret ?? 'pinit-phase3-dev';
}

function aesKey(): Buffer {
  return crypto.createHmac('sha256', signingSecret()).update('aes-256-gcm-v1').digest();
}

export function sha256Hex(data: Buffer | string): string {
  return crypto.createHash('sha256').update(data).digest('hex');
}

export function encryptPayload(plaintext: object): { ciphertext: string; iv: string; tag: string } {
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv('aes-256-gcm', aesKey(), iv);
  const json = JSON.stringify(plaintext);
  const enc = Buffer.concat([cipher.update(json, 'utf8'), cipher.final()]);
  const tag = cipher.getAuthTag();
  return {
    ciphertext: enc.toString('base64url'),
    iv: iv.toString('base64url'),
    tag: tag.toString('base64url'),
  };
}

export function decryptPayload<T extends object>(enc: {
  ciphertext: string;
  iv: string;
  tag: string;
}): T {
  const decipher = crypto.createDecipheriv(
    'aes-256-gcm',
    aesKey(),
    Buffer.from(enc.iv, 'base64url'),
  );
  decipher.setAuthTag(Buffer.from(enc.tag, 'base64url'));
  const plain = Buffer.concat([
    decipher.update(Buffer.from(enc.ciphertext, 'base64url')),
    decipher.final(),
  ]).toString('utf8');
  return JSON.parse(plain) as T;
}

export function signEd25519(message: string | Buffer): string | null {
  if (!ED25519_CACHE) return null;
  const sig = crypto.sign(null, Buffer.from(message), ED25519_CACHE.privateKey);
  return sig.toString('base64url');
}

export function verifyEd25519(message: string | Buffer, signatureB64: string): boolean {
  if (!ED25519_CACHE) return false;
  try {
    return crypto.verify(
      null,
      Buffer.from(message),
      ED25519_CACHE.publicKey,
      Buffer.from(signatureB64, 'base64url'),
    );
  } catch {
    return false;
  }
}

export function getPublicKeyPem(): string | null {
  if (!ED25519_CACHE) return null;
  return ED25519_CACHE.publicKey.export({ type: 'spki', format: 'pem' }).toString();
}

export function hmacSign(payload: string): string {
  return crypto.createHmac('sha256', signingSecret()).update(payload).digest('base64url');
}

export function hmacVerify(payload: string, signature: string): boolean {
  const expected = hmacSign(payload);
  try {
    return crypto.timingSafeEqual(Buffer.from(expected), Buffer.from(signature));
  } catch {
    return false;
  }
}
