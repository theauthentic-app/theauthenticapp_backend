import { Module } from '@nestjs/common';
import { AuditModule } from '../audit/audit.module';
import { BillingModule } from '../billing/billing.module';
import { WebhooksModule } from '../webhooks/webhooks.module';
import { ApiKeysService } from './api-keys.service';
import { PlatformController } from './platform.controller';

@Module({
  imports: [AuditModule, WebhooksModule, BillingModule],
  controllers: [PlatformController],
  providers: [ApiKeysService],
  exports: [ApiKeysService],
})
export class ApiKeysModule {}
