import { Module } from '@nestjs/common';
import { AuditModule } from '../audit/audit.module';
import { NotificationsModule } from '../notifications/notifications.module';
import { BillingController } from './billing.controller';
import { BillingJobs } from './billing.jobs';
import { BillingService } from './billing.service';
import { PaystackService } from './paystack.service';

@Module({
  imports: [AuditModule, NotificationsModule],
  controllers: [BillingController],
  providers: [BillingService, PaystackService, BillingJobs],
  exports: [BillingService],
})
export class BillingModule {}
