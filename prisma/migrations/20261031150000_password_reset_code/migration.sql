-- AlterTable
ALTER TABLE "PasswordReset" ADD COLUMN "codeHash" TEXT;

-- CreateIndex
CREATE INDEX "PasswordReset_userId_codeHash_idx" ON "PasswordReset"("userId", "codeHash");

-- AlterEnum
ALTER TYPE "AuditAction" ADD VALUE 'REPORT_REVIEWED';
