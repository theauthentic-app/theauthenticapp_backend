-- CreateEnum
CREATE TYPE "AnchorStatus" AS ENUM ('PENDING', 'QUEUED', 'ANCHORED', 'FAILED');

-- AlterEnum
ALTER TYPE "AuditAction" ADD VALUE 'IDENTITY_ANCHORED';

-- CreateTable
CREATE TABLE "IdentityAnchor" (
    "id" TEXT NOT NULL,
    "publicId" TEXT NOT NULL,
    "productIdentityId" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "commitment" TEXT NOT NULL,
    "status" "AnchorStatus" NOT NULL DEFAULT 'PENDING',
    "chainKey" TEXT,
    "chainId" INTEGER,
    "nativeCurrency" TEXT,
    "txHash" TEXT,
    "blockNumber" BIGINT,
    "merkleRoot" TEXT,
    "merkleProof" JSONB,
    "leafIndex" INTEGER,
    "explorerUrl" TEXT,
    "errorMessage" TEXT,
    "anchoredAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "IdentityAnchor_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "IdentityAnchor_publicId_key" ON "IdentityAnchor"("publicId");

-- CreateIndex
CREATE UNIQUE INDEX "IdentityAnchor_productIdentityId_key" ON "IdentityAnchor"("productIdentityId");

-- CreateIndex
CREATE INDEX "IdentityAnchor_status_createdAt_idx" ON "IdentityAnchor"("status", "createdAt");

-- CreateIndex
CREATE INDEX "IdentityAnchor_organizationId_idx" ON "IdentityAnchor"("organizationId");

-- CreateIndex
CREATE INDEX "IdentityAnchor_commitment_idx" ON "IdentityAnchor"("commitment");

-- CreateIndex
CREATE INDEX "IdentityAnchor_txHash_idx" ON "IdentityAnchor"("txHash");

-- AddForeignKey
ALTER TABLE "IdentityAnchor" ADD CONSTRAINT "IdentityAnchor_productIdentityId_fkey" FOREIGN KEY ("productIdentityId") REFERENCES "ProductIdentity"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "IdentityAnchor" ADD CONSTRAINT "IdentityAnchor_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;
