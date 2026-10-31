-- AlterTable
ALTER TABLE "EmailVerificationToken" ADD COLUMN "codeHash" TEXT;

-- CreateIndex
CREATE INDEX "EmailVerificationToken_userId_codeHash_idx" ON "EmailVerificationToken"("userId", "codeHash");
