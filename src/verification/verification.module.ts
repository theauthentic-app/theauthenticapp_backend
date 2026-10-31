import { Module } from '@nestjs/common';
import { BlockchainModule } from '../blockchain/blockchain.module';
import { CatalogLookupModule } from '../catalog-lookup/catalog-lookup.module';
import { NotificationsModule } from '../notifications/notifications.module';
import { WebhooksModule } from '../webhooks/webhooks.module';
import { BarcodeDecoderService } from './barcode-decoder.service';
import { VerificationController } from './verification.controller';
import { VerificationService } from './verification.service';

@Module({
  imports: [
    WebhooksModule,
    CatalogLookupModule,
    NotificationsModule,
    BlockchainModule,
  ],
  controllers: [VerificationController],
  providers: [VerificationService, BarcodeDecoderService],
  exports: [VerificationService, BarcodeDecoderService],
})
export class VerificationModule {}
