-- One encrypted government document per account, bound to the biometric identity.
-- No face embedding and no ID number are stored on this row.

CREATE TABLE "government_id_records" (
    "id" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "userId" TEXT NOT NULL,
    "biometricIdentityId" TEXT NOT NULL,
    "documentType" TEXT NOT NULL,
    "sealedAt" TIMESTAMP(3) NOT NULL,
    "storagePath" TEXT NOT NULL,
    "contentHash" TEXT NOT NULL,
    "mimeType" TEXT NOT NULL,
    "byteLength" INTEGER NOT NULL,
    "encryptionKeyVersion" TEXT NOT NULL DEFAULT 'v1',
    "faceBinding" TEXT NOT NULL DEFAULT 'REQUIRES_RECHECK',
    "faceBindingCheckedAt" TIMESTAMP(3),

    CONSTRAINT "government_id_records_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "government_id_records_userId_key" ON "government_id_records"("userId");

CREATE INDEX "government_id_records_biometricIdentityId_idx" ON "government_id_records"("biometricIdentityId");

ALTER TABLE "government_id_records" ADD CONSTRAINT "government_id_records_userId_fkey" FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "government_id_records" ADD CONSTRAINT "government_id_records_biometricIdentityId_fkey" FOREIGN KEY ("biometricIdentityId") REFERENCES "biometric_identities"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
