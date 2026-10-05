/**
 * Camera-sensor PRNU is a forensic sidecar, not a DNA layer number
 * (L9 remains Origin) and not a PINIT user identity.
 *
 * Compact residuals are stored for correlation only — not a full PRNU image.
 */
export const PRNU_CAMERA_DISCLAIMER =
  'PRNU correlates a camera sensor. It does not identify a PINIT user or prove ownership by itself.';

export type PrnuQualityStatus = 'OK' | 'INCONCLUSIVE' | 'INSUFFICIENT';

export type CameraSensorCandidate = {
  dnaRecordId: string;
  fingerprintId: string;
  correlation: number;
};

export type CameraForensicsStored = {
  version: 1;
  fingerprintId: string | null;
  correlation: number | null;
  quality: number;
  qualityStatus: PrnuQualityStatus;
  residualB64: string | null;
  dim: number;
  sameCameraCandidates: CameraSensorCandidate[];
  enrolledNewProfile: boolean;
  disclaimer: string;
  processedAt: string;
};

/** API / intelligence payload — never includes residualB64. */
export type CameraForensicsPublic = Omit<CameraForensicsStored, 'residualB64'> & {
  residualStored: boolean;
};
