-- AlterTable
ALTER TABLE "WebhookEndpoint" ADD COLUMN "consecutiveFailures" INTEGER NOT NULL DEFAULT 0;

-- AlterTable
ALTER TABLE "WebhookDelivery" ADD COLUMN "httpStatus" INTEGER;
ALTER TABLE "WebhookDelivery" ADD COLUMN "nextAttemptAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP;

-- CreateIndex
CREATE INDEX "WebhookDelivery_status_nextAttemptAt_idx" ON "WebhookDelivery"("status", "nextAttemptAt");
