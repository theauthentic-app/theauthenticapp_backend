import { Module } from '@nestjs/common';
import { BlockchainModule } from '../blockchain/blockchain.module';
import { HealthController } from './health.controller';
import { HealthService } from './health.service';

@Module({
  imports: [BlockchainModule],
  controllers: [HealthController],
  providers: [HealthService],
})
export class HealthModule {}
