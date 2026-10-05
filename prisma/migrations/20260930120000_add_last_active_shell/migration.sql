-- CreateEnum
CREATE TYPE "WorkspaceShell" AS ENUM ('PERSONAL', 'BUSINESS');

-- AlterTable
ALTER TABLE "users" ADD COLUMN "lastActiveShell" "WorkspaceShell" NOT NULL DEFAULT 'PERSONAL';
