import { Injectable, Logger } from '@nestjs/common';
import { Cron, CronExpression } from '@nestjs/schedule';
import { PrismaService } from '../database/prisma.service';
import { assertPublicWebhookUrl } from './webhook-url.util';
import { WebhooksService } from './webhooks.service';

@Injectable()
export class WebhookDeliveryProcessor {
  private readonly logger = new Logger(WebhookDeliveryProcessor.name);
  private running = false;

  constructor(
    private readonly prisma: PrismaService,
    private readonly webhooks: WebhooksService,
  ) {}

  @Cron(CronExpression.EVERY_5_SECONDS)
  async tick() {
    if (this.running) return;
    this.running = true;
    try {
      await this.drain();
    } catch (error) {
      this.logger.error(error);
    } finally {
      this.running = false;
    }
  }

  private async drain() {
    const due = await this.prisma.webhookDelivery.findMany({
      where: {
        status: 'PENDING',
        nextAttemptAt: { lte: new Date() },
        endpoint: { status: 'ACTIVE' },
      },
      include: { endpoint: true },
      orderBy: { nextAttemptAt: 'asc' },
      take: 25,
    });

    for (const delivery of due) {
      const claimed = await this.prisma.webhookDelivery.updateMany({
        where: {
          id: delivery.id,
          status: 'PENDING',
          attempts: delivery.attempts,
        },
        data: { attempts: { increment: 1 } },
      });
      if (claimed.count !== 1) continue;

      const body = JSON.stringify({
        eventId: delivery.eventId,
        eventType: delivery.eventType,
        createdAt: delivery.createdAt.toISOString(),
        data: delivery.payload,
      });
      const signature = this.webhooks.sign(delivery.endpoint.secret, body);

      try {
        await assertPublicWebhookUrl(delivery.endpoint.url);
        const controller = new AbortController();
        const timeout = setTimeout(() => controller.abort(), 10_000);
        const response = await fetch(delivery.endpoint.url, {
          method: 'POST',
          headers: {
            'content-type': 'application/json',
            'X-Authentic-Event': delivery.eventType,
            'X-Authentic-Delivery-Id': delivery.id,
            'X-Authentic-Signature': `sha256=${signature}`,
          },
          body,
          redirect: 'manual',
          signal: controller.signal,
        });
        clearTimeout(timeout);

        if (response.status >= 200 && response.status < 300) {
          await this.webhooks.markSuccess(
            delivery.id,
            delivery.endpointId,
            response.status,
          );
          continue;
        }

        await this.webhooks.markFailure(
          delivery.id,
          delivery.endpointId,
          delivery.attempts + 1,
          `HTTP ${response.status}`,
          response.status,
        );
      } catch (error) {
        const message =
          error instanceof Error ? error.message : 'Webhook delivery failed';
        await this.webhooks.markFailure(
          delivery.id,
          delivery.endpointId,
          delivery.attempts + 1,
          message,
        );
      }
    }
  }
}
