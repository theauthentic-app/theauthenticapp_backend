import { Module } from '@nestjs/common';
import { AuditModule } from '../audit/audit.module';
import { BillingModule } from '../billing/billing.module';
import { NotificationsModule } from '../notifications/notifications.module';
import { AdminController } from './admin.controller';

@Module({
  imports: [AuditModule, BillingModule, NotificationsModule],
  controllers: [AdminController],
})
export class AdminModule {}
