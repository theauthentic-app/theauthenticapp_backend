-- CreateTable
CREATE TABLE "WalletItem" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "productIdentityId" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "WalletItem_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "WalletItem_userId_idx" ON "WalletItem"("userId");

-- CreateIndex
CREATE UNIQUE INDEX "WalletItem_userId_productIdentityId_key" ON "WalletItem"("userId", "productIdentityId");

-- AddForeignKey
ALTER TABLE "WalletItem" ADD CONSTRAINT "WalletItem_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "WalletItem" ADD CONSTRAINT "WalletItem_productIdentityId_fkey" FOREIGN KEY ("productIdentityId") REFERENCES "ProductIdentity"("id") ON DELETE CASCADE ON UPDATE CASCADE;
