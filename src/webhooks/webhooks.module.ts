import { Module } from '@nestjs/common';
import { WebhookDeliveryProcessor } from './webhook-delivery.processor';
import { WebhooksService } from './webhooks.service';

@Module({
  providers: [WebhooksService, WebhookDeliveryProcessor],
  exports: [WebhooksService],
})
export class WebhooksModule {}
