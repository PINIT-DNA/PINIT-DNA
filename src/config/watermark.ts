/**
 * Invisible watermark embedding at vault-store time (DCT/DWT/steganography).
 * OFF by default — share/TEP watermarks remain independent.
 */
export function isInvisibleWatermarkVaultEmbeddingEnabled(): boolean {
  return process.env.INVISIBLE_WATERMARK_EMBEDDING_ENABLED === 'true';
}
