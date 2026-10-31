import { Module } from '@nestjs/common';
import { AuditModule } from '../audit/audit.module';
import { BillingModule } from '../billing/billing.module';
import { BlockchainModule } from '../blockchain/blockchain.module';
import { NotificationsModule } from '../notifications/notifications.module';
import { IdentityPrintService } from './identity-print.service';
import { ProductIdentitiesController } from './product-identities.controller';
import { ProductIdentitiesService } from './product-identities.service';

@Module({
  imports: [
    AuditModule,
    BillingModule,
    NotificationsModule,
    BlockchainModule,
  ],
  controllers: [ProductIdentitiesController],
  providers: [ProductIdentitiesService, IdentityPrintService],
  exports: [ProductIdentitiesService],
})
export class ProductIdentitiesModule {}
