import { Module } from '@nestjs/common';
import { CatalogLookupModule } from '../catalog-lookup/catalog-lookup.module';
import { NotificationsModule } from '../notifications/notifications.module';
import { WebhooksModule } from '../webhooks/webhooks.module';
import { BarcodeDecoderService } from './barcode-decoder.service';
import { VerificationController } from './verification.controller';
import { VerificationService } from './verification.service';

@Module({
  imports: [WebhooksModule, CatalogLookupModule, NotificationsModule],
  controllers: [VerificationController],
  providers: [VerificationService, BarcodeDecoderService],
  exports: [VerificationService, BarcodeDecoderService],
})
export class VerificationModule {}
