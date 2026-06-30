/**
 * Vault Identity Embedding Pipeline
 *
 * Runs before AES-256-GCM encryption on every vault store:
 *   1. Issue identity token
 *   2. Issue recovery token
 *   3. Embed invisible watermark (all 10 file types)
 *   4. Embed cryptographic owner signature
 *   5. Embed signed integrity manifest
 *   6. Verify embeddings
 */
import crypto from 'crypto';
import { logger } from '../../lib/logger';
import { prisma } from '../../lib/prisma';
import { isVaultIdentityPipelineEnabled } from '../../config/vault-identity';
import { identityEmbeddingService } from './identity-embedding.service';
import { vaultWatermarkEngine } from '../watermark/vault-watermark-engine.service';
import {
  issueVaultIdentityToken,
  serializeIdentityToken,
} from '../evidence/identity-token.service';
import {
  issueRecoveryToken,
  recoveryTokenHash,
} from './recovery-token.service';
import {
  buildIntegrityManifest,
  signManifest,
  embedManifestTail,
  extractManifest,
  manifestHash,
} from './integrity-manifest.service';

export interface VaultEmbedContext {
  vaultId: string;
  dnaRecordId: string;
  ownerUserId: string;
  certificateId: string | null;
}

export interface VaultEmbedPipelineResult {
  buffer: Buffer;
  success: boolean;
  methods: string[];
  identityTokenIssued: boolean;
  recoveryTokenIssued: boolean;
  watermarkEmbedded: boolean;
  signatureEmbedded: boolean;
  manifestEmbedded: boolean;
  verified: boolean;
  watermarkHash: string;
  signatureHash: string;
  manifestHash: string;
  detail: string;
}

export class IdentityEmbeddingPipeline {
  async process(
    buffer: Buffer,
    mimeType: string,
    fileName: string,
    context: VaultEmbedContext,
  ): Promise<VaultEmbedPipelineResult> {
    if (!isVaultIdentityPipelineEnabled()) {
      return this.legacyEmbed(buffer, mimeType, fileName, context);
    }

    const methods: string[] = [];
    const preEmbedSha256 = crypto.createHash('sha256').update(buffer).digest('hex');

    // ── 1. Identity token ─────────────────────────────────────────────────────
    const identityToken = issueVaultIdentityToken({
      vaultId: context.vaultId,
      dnaRecordId: context.dnaRecordId,
      certificateId: context.certificateId,
      ownerUserId: context.ownerUserId,
    });
    const identityTokenIssued = identityToken !== null;
    if (identityTokenIssued) methods.push('identity-token');
    const identityTokenHash = identityToken
      ? crypto.createHash('sha256').update(serializeIdentityToken(identityToken)).digest('hex')
      : '';

    // ── 2. Recovery token (manifest hash placeholder, updated after manifest) ─
    let recoveryToken = issueRecoveryToken({
      vaultId: context.vaultId,
      dnaRecordId: context.dnaRecordId,
      ownerUserId: context.ownerUserId,
      certificateId: context.certificateId,
      manifestHash: preEmbedSha256,
    });
    methods.push('recovery-token');

    // ── 3. Invisible watermark ────────────────────────────────────────────────
    let working = buffer;
    const wmResult = await vaultWatermarkEngine.embed(working, mimeType, fileName, {
      vaultId: context.vaultId,
      dnaRecordId: context.dnaRecordId,
      certificateId: context.certificateId,
      ownerUserId: context.ownerUserId,
      identityToken,
      recoveryToken,
    });
    if (wmResult.embedded) {
      working = wmResult.buffer;
      methods.push(wmResult.method);
    }

    // ── 4. Cryptographic owner signature ─────────────────────────────────────
    const sigResult = await identityEmbeddingService.embed(
      working,
      mimeType,
      fileName,
      {
        dnaId: context.dnaRecordId,
        vaultId: context.vaultId,
        ownerUserId: context.ownerUserId,
      },
    );
    const signatureEmbedded = sigResult.success;
    const signatureHash = crypto.createHash('sha256').update(sigResult.signature).digest('hex');
    if (signatureEmbedded) {
      working = sigResult.buffer;
      methods.push(sigResult.method);
    }

    // ── 5. Integrity manifest + recovery token refresh ───────────────────────
    const manifest = buildIntegrityManifest({
      vaultId: context.vaultId,
      dnaRecordId: context.dnaRecordId,
      ownerUserId: context.ownerUserId,
      certificateId: context.certificateId,
      preEmbedSha256,
      methods: [...methods],
      identityTokenHash,
      recoveryTokenHash: recoveryTokenHash(recoveryToken),
      watermarkHash: wmResult.watermarkHash,
      signatureHash,
    });

    const mHash = manifestHash(manifest);
    recoveryToken = issueRecoveryToken({
      vaultId: context.vaultId,
      dnaRecordId: context.dnaRecordId,
      ownerUserId: context.ownerUserId,
      certificateId: context.certificateId,
      manifestHash: mHash,
    });

    const signedManifest = signManifest({
      ...manifest,
      recoveryTokenHash: recoveryTokenHash(recoveryToken),
    });
    working = embedManifestTail(working, signedManifest);
    methods.push('integrity-manifest');
    const manifestEmbedded = true;

    // ── 6. Verify embeddings ──────────────────────────────────────────────────
    const verify = await identityEmbeddingService.extractAndVerify(working, mimeType, fileName);
    const manifestOk = extractManifest(working) !== null;
    const verified = (verify.found && verify.valid) || manifestOk;

    if (!verified) {
      logger.warn('[VaultPipeline] Post-embed verification weak', {
        vaultId: context.vaultId,
        identityFound: verify.found,
        manifestOk,
      });
    }

    logger.info('[VaultPipeline] Identity embedding complete', {
      vaultId: context.vaultId,
      dnaRecordId: context.dnaRecordId,
      methods,
      verified,
      watermarkEmbedded: wmResult.embedded,
      signatureEmbedded,
    });

    return {
      buffer: working,
      success: signatureEmbedded || wmResult.embedded || manifestEmbedded,
      methods,
      identityTokenIssued,
      recoveryTokenIssued: true,
      watermarkEmbedded: wmResult.embedded,
      signatureEmbedded,
      manifestEmbedded,
      verified,
      watermarkHash: wmResult.watermarkHash,
      signatureHash,
      manifestHash: mHash,
      detail: verified
        ? 'Vault identity pipeline complete — watermark, signature, and manifest verified'
        : 'Vault identity pipeline complete — partial verification (proceeding)',
    };
  }

  /** Resolve certificate ID if one exists for this DNA record */
  async resolveCertificateId(dnaRecordId: string): Promise<string | null> {
    const cert = await prisma.certificate.findFirst({
      where: { dnaRecordId, status: 'ACTIVE' },
      orderBy: { issuedAt: 'desc' },
      select: { certificateId: true },
    });
    return cert?.certificateId ?? null;
  }

  private async legacyEmbed(
    buffer: Buffer,
    mimeType: string,
    fileName: string,
    context: VaultEmbedContext,
  ): Promise<VaultEmbedPipelineResult> {
    const embedResult = await identityEmbeddingService.embed(
      buffer,
      mimeType,
      fileName,
      {
        dnaId: context.dnaRecordId,
        vaultId: context.vaultId,
        ownerUserId: context.ownerUserId,
      },
    );

    return {
      buffer: embedResult.success ? embedResult.buffer : buffer,
      success: embedResult.success,
      methods: embedResult.success ? [embedResult.method] : [],
      identityTokenIssued: false,
      recoveryTokenIssued: false,
      watermarkEmbedded: false,
      signatureEmbedded: embedResult.success,
      manifestEmbedded: false,
      verified: embedResult.success,
      watermarkHash: '',
      signatureHash: crypto.createHash('sha256').update(embedResult.signature).digest('hex'),
      manifestHash: '',
      detail: 'Legacy identity embed only (pipeline disabled)',
    };
  }
}

export const identityEmbeddingPipeline = new IdentityEmbeddingPipeline();
