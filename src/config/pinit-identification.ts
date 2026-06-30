/** Enterprise PINIT identification engine — always exhaust all recovery stages. */
function flag(key: string, defaultValue = true): boolean {
  const v = (process.env[key] ?? '').trim().toLowerCase();
  if (!v) return defaultValue;
  return v === '1' || v === 'true' || v === 'yes';
}

export const pinitIdentificationConfig = {
  enabled: flag('PINIT_IDENTIFICATION_ENGINE_ENABLED', true),
  /** Deep 15-layer compare against top-N vault candidates */
  deepCompareTopN: parseInt(process.env['PINIT_DEEP_COMPARE_TOP_N'] ?? '5', 10),
  /** Minimum ownership confidence to declare PINIT origin */
  identifyThreshold: parseInt(process.env['PINIT_IDENTIFY_THRESHOLD'] ?? '52', 10),
  /** Relaxed perceptual threshold for camera/screenshot probes */
  cameraPhashThreshold: parseFloat(process.env['PINIT_CAMERA_PHASH_THRESHOLD'] ?? '0.52'),
  standardPhashThreshold: parseFloat(process.env['PINIT_STANDARD_PHASH_THRESHOLD'] ?? '0.65'),
};
