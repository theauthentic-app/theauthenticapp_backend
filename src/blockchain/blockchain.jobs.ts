import { Injectable, Logger } from '@nestjs/common';
import { Cron, CronExpression } from '@nestjs/schedule';
import { BlockchainService } from './blockchain.service';

@Injectable()
export class BlockchainJobs {
  private readonly logger = new Logger(BlockchainJobs.name);
  private running = false;

  constructor(private readonly blockchain: BlockchainService) {}

  @Cron(CronExpression.EVERY_MINUTE)
  async flush() {
    if (!this.blockchain.enabled() || this.running) return;
    this.running = true;
    try {
      const result = await this.blockchain.flushPending(100);
      if (result.processed) {
        this.logger.log(
          `Blockchain flush processed=${result.processed} anchored=${result.anchored}`,
        );
      }
    } catch (error) {
      this.logger.error(`Blockchain flush failed: ${String(error)}`);
    } finally {
      this.running = false;
    }
  }
}
