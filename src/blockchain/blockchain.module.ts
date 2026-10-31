import { Module } from '@nestjs/common';
import { AuditModule } from '../audit/audit.module';
import { BlockchainController } from './blockchain.controller';
import { BlockchainJobs } from './blockchain.jobs';
import { BlockchainService } from './blockchain.service';

@Module({
  imports: [AuditModule],
  controllers: [BlockchainController],
  providers: [BlockchainService, BlockchainJobs],
  exports: [BlockchainService],
})
export class BlockchainModule {}
