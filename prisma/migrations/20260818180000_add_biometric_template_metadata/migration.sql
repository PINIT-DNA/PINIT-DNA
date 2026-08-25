-- Biometric template metadata: versioning, quality, status, encryption key version.
--
-- Additive only. Every column has a default (or is nullable), so the existing
-- face/voice/fingerprint template rows backfill automatically with no data loss.
--
-- Written by hand rather than generated: `prisma migrate diff` also wanted to emit
-- `DROP TABLE "spatial_auth_packages"` — a DNA-engine table that exists in the
-- database but was never added to schema.prisma (pre-existing drift, unrelated to
-- biometric auth, holds real DNA rows). That drop is deliberately excluded here.

-- AlterTable
ALTER TABLE "face_templates" ADD COLUMN     "algorithmVersion" TEXT NOT NULL DEFAULT '1',
ADD COLUMN     "embeddingVersion" TEXT NOT NULL DEFAULT '1',
ADD COLUMN     "encryptionKeyVersion" TEXT NOT NULL DEFAULT 'v1',
ADD COLUMN     "modelVersion" TEXT NOT NULL DEFAULT 'face-api-tiny-v1',
ADD COLUMN     "qualityScore" DOUBLE PRECISION,
ADD COLUMN     "status" TEXT NOT NULL DEFAULT 'ACTIVE',
ADD COLUMN     "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP;

-- AlterTable
ALTER TABLE "fingerprint_templates" ADD COLUMN     "algorithmVersion" TEXT NOT NULL DEFAULT '1',
ADD COLUMN     "embeddingVersion" TEXT NOT NULL DEFAULT '1',
ADD COLUMN     "encryptionKeyVersion" TEXT NOT NULL DEFAULT 'v1',
ADD COLUMN     "modelVersion" TEXT NOT NULL DEFAULT 'webauthn-device-v1',
ADD COLUMN     "qualityScore" DOUBLE PRECISION,
ADD COLUMN     "status" TEXT NOT NULL DEFAULT 'ACTIVE',
ADD COLUMN     "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP;

-- AlterTable
ALTER TABLE "voice_templates" ADD COLUMN     "algorithmVersion" TEXT NOT NULL DEFAULT '1',
ADD COLUMN     "embeddingVersion" TEXT NOT NULL DEFAULT '1',
ADD COLUMN     "encryptionKeyVersion" TEXT NOT NULL DEFAULT 'v1',
ADD COLUMN     "modelVersion" TEXT NOT NULL DEFAULT 'web-audio-fft-v1',
ADD COLUMN     "qualityScore" DOUBLE PRECISION,
ADD COLUMN     "status" TEXT NOT NULL DEFAULT 'ACTIVE',
ADD COLUMN     "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP;
