-- CreateTable
CREATE TABLE "thumbnail_tokens" (
    "id" TEXT NOT NULL,
    "token" TEXT NOT NULL,
    "ownerUserId" TEXT NOT NULL,
    "vaultId" TEXT NOT NULL,
    "dnaRecordId" TEXT,
    "originalFileName" TEXT NOT NULL,
    "mimeType" TEXT NOT NULL,
    "fileType" TEXT NOT NULL,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "viewCount" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "thumbnail_tokens_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "thumbnail_accesses" (
    "id" TEXT NOT NULL,
    "thumbnailId" TEXT NOT NULL,
    "ipAddress" TEXT,
    "userAgent" TEXT,
    "referer" TEXT,
    "platform" TEXT,
    "country" TEXT,
    "city" TEXT,
    "device" TEXT,
    "browser" TEXT,
    "os" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "thumbnail_accesses_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "thumbnail_tokens_token_key" ON "thumbnail_tokens"("token");

-- CreateIndex
CREATE INDEX "thumbnail_tokens_ownerUserId_idx" ON "thumbnail_tokens"("ownerUserId");

-- CreateIndex
CREATE INDEX "thumbnail_tokens_token_idx" ON "thumbnail_tokens"("token");

-- CreateIndex
CREATE INDEX "thumbnail_accesses_thumbnailId_idx" ON "thumbnail_accesses"("thumbnailId");

-- CreateIndex
CREATE INDEX "thumbnail_accesses_createdAt_idx" ON "thumbnail_accesses"("createdAt");

-- AddForeignKey
ALTER TABLE "thumbnail_tokens" ADD CONSTRAINT "thumbnail_tokens_ownerUserId_fkey" FOREIGN KEY ("ownerUserId") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "thumbnail_accesses" ADD CONSTRAINT "thumbnail_accesses_thumbnailId_fkey" FOREIGN KEY ("thumbnailId") REFERENCES "thumbnail_tokens"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
