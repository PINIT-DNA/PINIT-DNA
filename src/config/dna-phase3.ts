/**
 * DNA Engine Phase 3 — Enterprise Watermark & Evidence (v2.3)
 * All flags OFF by default — fully backward compatible.
 */
import { isInvisibleWatermarkVaultEmbeddingEnabled } from './watermark';

function flag(key: string, defaultValue = false): boolean {
  const v = (process.env[key] ?? '').trim().toLowerCase();
  if (!v) return defaultValue;
  return v === '1' || v === 'true' || v === 'yes';
}

export const dnaPhase3 = {
  /** Master switch — must be true for any Phase 3 feature */
  enabled: flag('DNA_PHASE3_ENABLED', false),

  /** Cryptographic identity token on Protected Download */
  protectedDownloadToken: flag('DNA_P3_PROTECTED_DOWNLOAD_TOKEN', true),

  /** File-type watermark embedding engine */
  watermarkEmbedding: flag('DNA_P3_WATERMARK_EMBED', true),

  /** Watermark recovery before DNA compare fallback */
  watermarkRecovery: flag('DNA_P3_WATERMARK_RECOVERY', true),

  /** Signed PDF reports + QR verification */
  signedReports: flag('DNA_P3_SIGNED_REPORTS', true),

  /** Server-side evidence ZIP package */
  evidencePackage: flag('DNA_P3_EVIDENCE_PACKAGE', true),

  /** Vault-store invisible watermark (uses INVISIBLE_WATERMARK_EMBEDDING_ENABLED) */
  vaultWatermark: flag('DNA_P3_VAULT_WATERMARK', true),
};

export function isPhase3Active(): boolean {
  return dnaPhase3.enabled;
}

export function isPhase3WatermarkEmbedActive(): boolean {
  return dnaPhase3.enabled && dnaPhase3.watermarkEmbedding;
}

export function isPhase3WatermarkRecoveryActive(): boolean {
  return dnaPhase3.enabled && dnaPhase3.watermarkRecovery;
}

export function isPhase3ProtectedDownloadTokenActive(): boolean {
  return dnaPhase3.enabled && dnaPhase3.protectedDownloadToken;
}

export function isPhase3SignedReportsActive(): boolean {
  return dnaPhase3.enabled && dnaPhase3.signedReports;
}

export function isPhase3EvidencePackageActive(): boolean {
  return dnaPhase3.enabled && dnaPhase3.evidencePackage;
}

export function isPhase3VaultWatermarkActive(): boolean {
  return (
    dnaPhase3.enabled &&
    dnaPhase3.vaultWatermark &&
    isInvisibleWatermarkVaultEmbeddingEnabled()
  );
}
