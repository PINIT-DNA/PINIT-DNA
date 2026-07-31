/**
 * Vault integrity manifest — signed recovery metadata embedded in every vaulted file.
 */
import crypto from 'crypto';
import { config } from '../../config';

export const MANIFEST_MARKER = 'PINIT-MANIFEST';
export const MANIFEST_VERSION = 1;

export interface IntegrityManifest {
  v: number;
  vaultId: string;
  dnaRecordId: string;
  ownerUserId: string;
  certificateId: string | null;
  embeddedAt: string;
  preEmbedSha256: string;
  methods: string[];
  identityTokenHash: string;
  recoveryTokenHash: string;
  watermarkHash: string;
  signatureHash: string;
}

function signingSecret(): string {
  return process.env.PHASE3_SIGNING_SECRET ?? config.vault.masterSecret ?? 'pinit-manifest-dev';
}

function isHtmlFile(mimeType?: string, fileName?: string): boolean {
  const mime = (mimeType ?? '').toLowerCase().split(';')[0]?.trim() ?? '';
  const name = (fileName ?? '').toLowerCase();
  return (
    mime === 'text/html' ||
    mime === 'application/xhtml+xml' ||
    /\.html?$/.test(name) ||
    name.endsWith('.xhtml')
  );
}

export function buildIntegrityManifest(params: {
  vaultId: string;
  dnaRecordId: string;
  ownerUserId: string;
  certificateId: string | null;
  preEmbedSha256: string;
  methods: string[];
  identityTokenHash: string;
  recoveryTokenHash: string;
  watermarkHash: string;
  signatureHash: string;
}): IntegrityManifest {
  return {
    v: MANIFEST_VERSION,
    vaultId: params.vaultId,
    dnaRecordId: params.dnaRecordId,
    ownerUserId: params.ownerUserId,
    certificateId: params.certificateId,
    embeddedAt: new Date().toISOString(),
    preEmbedSha256: params.preEmbedSha256,
    methods: params.methods,
    identityTokenHash: params.identityTokenHash,
    recoveryTokenHash: params.recoveryTokenHash,
    watermarkHash: params.watermarkHash,
    signatureHash: params.signatureHash,
  };
}

export function signManifest(manifest: IntegrityManifest): string {
  const body = Buffer.from(JSON.stringify(manifest)).toString('base64url');
  const sig = crypto
    .createHmac('sha256', signingSecret())
    .update(body)
    .digest('base64url');
  return `${body}.${sig}`;
}

/**
 * Embed signed manifest. For HTML, wrap in an HTML comment so it stays invisible
 * when the page is opened in a browser.
 */
export function embedManifestTail(
  buffer: Buffer,
  signedManifest: string,
  opts?: { mimeType?: string; fileName?: string },
): Buffer {
  if (isHtmlFile(opts?.mimeType, opts?.fileName)) {
    const comment = Buffer.from(
      `\n<!--${MANIFEST_MARKER}:${signedManifest}:END-MANIFEST-->\n`,
      'utf8',
    );
    return Buffer.concat([buffer, comment]);
  }
  const marker = Buffer.from(`\x00${MANIFEST_MARKER}:`, 'latin1');
  const payload = Buffer.from(signedManifest, 'utf8');
  const end = Buffer.from(':END-MANIFEST\x00', 'latin1');
  return Buffer.concat([buffer, marker, payload, end]);
}

function parseSignedManifest(signed: string): IntegrityManifest | null {
  const dot = signed.lastIndexOf('.');
  if (dot < 0) return null;

  const body = signed.slice(0, dot);
  const sig = signed.slice(dot + 1);
  const expected = crypto
    .createHmac('sha256', signingSecret())
    .update(body)
    .digest('base64url');

  if (sig !== expected) return null;

  try {
    const manifest = JSON.parse(Buffer.from(body, 'base64url').toString('utf8')) as IntegrityManifest;
    if (manifest.v !== MANIFEST_VERSION) return null;
    return manifest;
  } catch {
    return null;
  }
}

export function extractManifest(buffer: Buffer): IntegrityManifest | null {
  const text = buffer.toString('latin1');

  // 1) Binary tail (images / docs)
  const startTag = `\x00${MANIFEST_MARKER}:`;
  const endTag = ':END-MANIFEST\x00';
  const start = text.lastIndexOf(startTag);
  if (start >= 0) {
    const end = text.indexOf(endTag, start);
    if (end >= 0) {
      const parsed = parseSignedManifest(text.slice(start + startTag.length, end));
      if (parsed) return parsed;
    }
  }

  // 2) HTML comment form (hidden in browser)
  const htmlStart = `<!--${MANIFEST_MARKER}:`;
  const htmlEnd = ':END-MANIFEST-->';
  const hs = text.lastIndexOf(htmlStart);
  if (hs >= 0) {
    const he = text.indexOf(htmlEnd, hs);
    if (he >= 0) {
      return parseSignedManifest(text.slice(hs + htmlStart.length, he));
    }
  }

  return null;
}

export function manifestHash(manifest: IntegrityManifest): string {
  return crypto.createHash('sha256').update(JSON.stringify(manifest)).digest('hex');
}
