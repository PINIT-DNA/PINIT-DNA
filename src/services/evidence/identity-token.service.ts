/**
 * Phase 3 — Protected Download identity token.
 * Opaque AES-encrypted payload + Ed25519 signature. No raw IDs in cleartext.
 */
import crypto from 'crypto';
import { encryptPayload, decryptPayload, signEd25519, verifyEd25519 } from './phase3-crypto.service';
import { isPhase3ProtectedDownloadTokenActive } from '../../config/dna-phase3';

export const IDENTITY_TOKEN_VERSION = 1;
export const IDENTITY_TOKEN_PREFIX = 'PINIT-IDT';

export interface IdentityTokenInner {
  /** Opaque HMAC references — not reversible without server secret */
  vaultRef: string;
  dnaRef: string;
  certRef: string | null;
  ownerRef: string;
  issuedAt: string;
}

export interface IdentityTokenEnvelope {
  v: number;
  iat: string;
  nonce: string;
  enc: { ciphertext: string; iv: string; tag: string };
  sig: string;
}

function opaqueRef(namespace: string, id: string): string {
  const secret = process.env.PHASE3_SIGNING_SECRET ?? process.env.VAULT_MASTER_SECRET ?? 'pinit';
  return crypto.createHmac('sha256', secret).update(`${namespace}:${id}`).digest('base64url').slice(0, 22);
}

export function issueIdentityToken(context: {
  vaultId: string;
  dnaRecordId: string;
  certificateId: string | null;
  ownerUserId: string;
}): IdentityTokenEnvelope | null {
  if (!isPhase3ProtectedDownloadTokenActive()) return null;

  const inner: IdentityTokenInner = {
    vaultRef: opaqueRef('vault', context.vaultId),
    dnaRef: opaqueRef('dna', context.dnaRecordId),
    certRef: context.certificateId ? opaqueRef('cert', context.certificateId) : null,
    ownerRef: opaqueRef('owner', context.ownerUserId),
    issuedAt: new Date().toISOString(),
  };

  const enc = encryptPayload({ ...inner, _ids: context });
  const nonce = crypto.randomBytes(16).toString('hex');
  const iat = new Date().toISOString();

  const envelope: Omit<IdentityTokenEnvelope, 'sig'> = {
    v: IDENTITY_TOKEN_VERSION,
    iat,
    nonce,
    enc,
  };

  const canonical = JSON.stringify(envelope);
  const sig = signEd25519(canonical);
  if (!sig) return null;

  return { ...envelope, sig };
}

export function serializeIdentityToken(token: IdentityTokenEnvelope): string {
  return `${IDENTITY_TOKEN_PREFIX}|${Buffer.from(JSON.stringify(token)).toString('base64url')}`;
}

export function parseIdentityToken(raw: string): IdentityTokenEnvelope | null {
  const trimmed = raw.trim();
  const payload = trimmed.startsWith(IDENTITY_TOKEN_PREFIX)
    ? trimmed.slice(IDENTITY_TOKEN_PREFIX.length + 1)
    : trimmed;
  try {
    const json = Buffer.from(payload, 'base64url').toString('utf8');
    return JSON.parse(json) as IdentityTokenEnvelope;
  } catch {
    return null;
  }
}

export function verifyIdentityToken(token: IdentityTokenEnvelope): {
  valid: boolean;
  inner?: IdentityTokenInner & { vaultId?: string; dnaRecordId?: string; certificateId?: string | null; ownerUserId?: string };
  detail: string;
} {
  const { sig, ...unsigned } = token;
  const canonical = JSON.stringify(unsigned);
  if (!verifyEd25519(canonical, sig)) {
    return { valid: false, detail: 'Ed25519 signature invalid' };
  }
  if (token.v !== IDENTITY_TOKEN_VERSION) {
    return { valid: false, detail: `Unsupported token version ${token.v}` };
  }

  try {
    const decrypted = decryptPayload<IdentityTokenInner & {
      _ids?: { vaultId: string; dnaRecordId: string; certificateId: string | null; ownerUserId: string };
    }>(token.enc);

    return {
      valid: true,
      inner: {
        vaultRef: decrypted.vaultRef,
        dnaRef: decrypted.dnaRef,
        certRef: decrypted.certRef,
        ownerRef: decrypted.ownerRef,
        issuedAt: decrypted.issuedAt,
        vaultId: decrypted._ids?.vaultId,
        dnaRecordId: decrypted._ids?.dnaRecordId,
        certificateId: decrypted._ids?.certificateId ?? null,
        ownerUserId: decrypted._ids?.ownerUserId,
      },
      detail: 'Identity token verified',
    };
  } catch {
    return { valid: false, detail: 'AES decryption failed — token damaged or forged' };
  }
}
