/** Canonical names for all 15 DNA layers (UI + reports). */
export const DNA_LAYER_REGISTRY: Record<number, { name: string; implementation: string }> = {
  1:  { name: 'Cryptographic', implementation: 'sha256_serialized' },
  2:  { name: 'Structural', implementation: 'sobel_edge_detection' },
  3:  { name: 'Perceptual', implementation: 'dct_phash' },
  4:  { name: 'Semantic', implementation: 'rgb_hsv_histogram' },
  5:  { name: 'Metadata', implementation: 'exif_metadata_stable' },
  6:  { name: 'Signature', implementation: 'lsb_steganography_hmac' },
  7:  { name: 'Behavioral', implementation: 'sha256_behavior_bundle' },
  8:  { name: 'Relationship', implementation: 'sha256_graph_hash' },
  9:  { name: 'Origin', implementation: 'sha256_origin_bundle' },
  10: { name: 'Evolution', implementation: 'markov_mutation_log' },
  11: { name: 'Deepfake Detection', implementation: 'ai_deepfake_analysis' },
  12: { name: 'Invisible Watermark', implementation: 'dct_frequency_watermark' },
  13: { name: 'Chain of Custody', implementation: 'legal_custody_chain' },
  14: { name: 'ZK Ownership Proof', implementation: 'hash_commitment_proof' },
  15: { name: 'Biometric Bind', implementation: 'biometric_hmac_bind' },
};
