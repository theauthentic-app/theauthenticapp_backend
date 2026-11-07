import { Module } from '@nestjs/common';
import { PaystackService } from '../billing/paystack.service';
import { BlockchainModule } from '../blockchain/blockchain.module';
import { HealthController } from './health.controller';
import { HealthService } from './health.service';

@Module({
  imports: [BlockchainModule],
  controllers: [HealthController],
  providers: [HealthService, PaystackService],
})
export class HealthModule {}
