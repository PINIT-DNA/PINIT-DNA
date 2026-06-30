/**
 * Vault-store identity embedding pipeline configuration.
 * ON by default — every file is protected before AES encryption.
 */
function flag(key: string, defaultValue: boolean): boolean {
  const v = (process.env[key] ?? '').trim().toLowerCase();
  if (!v) return defaultValue;
  return v === '1' || v === 'true' || v === 'yes';
}

/** Master switch for the full pre-encrypt identity pipeline */
export function isVaultIdentityPipelineEnabled(): boolean {
  return flag('VAULT_IDENTITY_PIPELINE_ENABLED', true);
}

/** Invisible watermark layer at vault store (DCT/DWT/metadata) */
export function isVaultInvisibleWatermarkEnabled(): boolean {
  return flag('VAULT_INVISIBLE_WATERMARK_ENABLED', true);
}
