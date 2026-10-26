import { Injectable, Logger } from '@nestjs/common';
import { Cron, CronExpression } from '@nestjs/schedule';
import { BillingService } from './billing.service';

@Injectable()
export class BillingJobs {
  private readonly logger = new Logger(BillingJobs.name);

  constructor(private readonly billing: BillingService) {}

  @Cron(CronExpression.EVERY_HOUR)
  async reconcile() {
    const result = await this.billing.reconcileSubscriptions();
    if (result.expired || result.trialEnding || result.periodEnding) {
      this.logger.log(
        `Billing reconcile expired=${result.expired} trialEnding=${result.trialEnding} periodEnding=${result.periodEnding}`,
      );
    }
  }
}
