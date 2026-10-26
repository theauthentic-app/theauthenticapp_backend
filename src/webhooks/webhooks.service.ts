import { Injectable } from '@nestjs/common';
import { createHmac } from 'crypto';
import { Prisma, WebhookDeliveryStatus, WebhookEndpointStatus } from '@prisma/client';
import { WEBHOOK_EVENTS } from '../common/constants/api-scopes';
import { AppError } from '../common/errors/app-error';
import { publicId } from '../common/utils/crypto.util';
import {
  paginatedResult,
  paginationOf,
  type PaginationInput,
} from '../common/utils/pagination.util';
import { PrismaService } from '../database/prisma.service';
import { assertPublicWebhookUrl } from './webhook-url.util';

const MAX_CONSECUTIVE_FAILURES = 10;

@Injectable()
export class WebhooksService {
  constructor(private readonly prisma: PrismaService) {}

  async createEndpoint(
    organizationId: string,
    input: { url: string; events: string[] },
  ) {
    await assertPublicWebhookUrl(input.url);
    const invalid = input.events.filter(
      (event) => !WEBHOOK_EVENTS.includes(event as (typeof WEBHOOK_EVENTS)[number]),
    );
    if (invalid.length) {
      throw new AppError(
        'INVALID_WEBHOOK_EVENT',
        `Unsupported webhook events: ${invalid.join(', ')}.`,
        400,
      );
    }
    const secret = publicId('whsec', 24);
    const endpoint = await this.prisma.webhookEndpoint.create({
      data: {
        organizationId,
        url: input.url,
        secret,
        events: input.events,
      },
    });
    return {
      id: endpoint.id,
      url: endpoint.url,
      events: endpoint.events,
      secret,
    };
  }

  async list(organizationId: string, query?: PaginationInput) {
    const { page, limit, skip, take } = paginationOf(query);
    const where = { organizationId };
    const [endpoints, total] = await this.prisma.$transaction([
      this.prisma.webhookEndpoint.findMany({
        where,
        orderBy: { createdAt: 'desc' },
        skip,
        take,
      }),
      this.prisma.webhookEndpoint.count({ where }),
    ]);
    return paginatedResult(
      endpoints.map((endpoint) => ({
        id: endpoint.id,
        url: endpoint.url,
        events: endpoint.events,
        status: endpoint.status,
        consecutiveFailures: endpoint.consecutiveFailures,
        createdAt: endpoint.createdAt,
      })),
      total,
      page,
      limit,
    );
  }

  async updateEndpoint(
    organizationId: string,
    id: string,
    input: { status?: WebhookEndpointStatus },
  ) {
    const endpoint = await this.requireEndpoint(organizationId, id);
    const updated = await this.prisma.webhookEndpoint.update({
      where: { id: endpoint.id },
      data: {
        status: input.status,
        consecutiveFailures:
          input.status === WebhookEndpointStatus.ACTIVE
            ? 0
            : endpoint.consecutiveFailures,
      },
    });
    return {
      id: updated.id,
      status: updated.status,
    };
  }

  async deleteEndpoint(organizationId: string, id: string) {
    const endpoint = await this.requireEndpoint(organizationId, id);
    await this.prisma.webhookEndpoint.delete({ where: { id: endpoint.id } });
    return { deleted: true };
  }

  async listDeliveries(
    organizationId: string,
    endpointId: string,
    query?: PaginationInput,
  ) {
    await this.requireEndpoint(organizationId, endpointId);
    const { page, limit, skip, take } = paginationOf(query);
    const where = { endpointId };
    const [rows, total] = await this.prisma.$transaction([
      this.prisma.webhookDelivery.findMany({
        where,
        orderBy: { createdAt: 'desc' },
        skip,
        take,
      }),
      this.prisma.webhookDelivery.count({ where }),
    ]);
    return paginatedResult(
      rows.map((row) => ({
        id: row.id,
        eventId: row.eventId,
        eventType: row.eventType,
        status: row.status,
        attempts: row.attempts,
        httpStatus: row.httpStatus,
        lastError: row.lastError,
        nextAttemptAt: row.nextAttemptAt,
        createdAt: row.createdAt,
      })),
      total,
      page,
      limit,
    );
  }

  async retryDelivery(organizationId: string, deliveryId: string) {
    const delivery = await this.prisma.webhookDelivery.findFirst({
      where: { id: deliveryId, endpoint: { organizationId } },
    });
    if (!delivery) {
      throw new AppError('DELIVERY_NOT_FOUND', 'Webhook delivery not found.', 404);
    }
    await this.prisma.webhookDelivery.update({
      where: { id: delivery.id },
      data: {
        status: WebhookDeliveryStatus.PENDING,
        nextAttemptAt: new Date(),
        lastError: null,
      },
    });
    return { retried: true, id: delivery.id };
  }

  async enqueue(
    organizationId: string,
    eventType: string,
    payload: Record<string, unknown>,
  ) {
    const endpoints = await this.prisma.webhookEndpoint.findMany({
      where: {
        organizationId,
        status: WebhookEndpointStatus.ACTIVE,
        events: { has: eventType },
      },
    });
    const eventId = publicId('evt');
    for (const endpoint of endpoints) {
      await this.prisma.webhookDelivery.create({
        data: {
          endpointId: endpoint.id,
          eventId,
          eventType,
          payload: payload as Prisma.InputJsonValue,
          status: WebhookDeliveryStatus.PENDING,
          nextAttemptAt: new Date(),
        },
      });
    }
    return { eventId, queued: endpoints.length };
  }

  sign(secret: string, body: string): string {
    return createHmac('sha256', secret).update(body).digest('hex');
  }

  backoffMs(attempt: number): number {
    const delays = [5_000, 30_000, 120_000, 600_000, 3_600_000];
    return delays[Math.min(attempt, delays.length - 1)] ?? 3_600_000;
  }

  async markSuccess(deliveryId: string, endpointId: string, httpStatus: number) {
    await this.prisma.webhookDelivery.update({
      where: { id: deliveryId },
      data: {
        status: WebhookDeliveryStatus.SUCCESS,
        httpStatus,
        lastError: null,
      },
    });
    await this.prisma.webhookEndpoint.update({
      where: { id: endpointId },
      data: { consecutiveFailures: 0 },
    });
  }

  async markFailure(
    deliveryId: string,
    endpointId: string,
    attempts: number,
    lastError: string,
    httpStatus?: number,
  ) {
    const terminal = attempts >= 5;
    await this.prisma.webhookDelivery.update({
      where: { id: deliveryId },
      data: {
        status: terminal
          ? WebhookDeliveryStatus.FAILED
          : WebhookDeliveryStatus.PENDING,
        httpStatus,
        lastError: lastError.slice(0, 500),
        nextAttemptAt: terminal
          ? new Date()
          : new Date(Date.now() + this.backoffMs(attempts)),
      },
    });
    const endpoint = await this.prisma.webhookEndpoint.update({
      where: { id: endpointId },
      data: { consecutiveFailures: { increment: 1 } },
    });
    if (endpoint.consecutiveFailures >= MAX_CONSECUTIVE_FAILURES) {
      await this.prisma.webhookEndpoint.update({
        where: { id: endpointId },
        data: { status: WebhookEndpointStatus.PAUSED },
      });
    }
  }

  private async requireEndpoint(organizationId: string, id: string) {
    const endpoint = await this.prisma.webhookEndpoint.findFirst({
      where: { id, organizationId },
    });
    if (!endpoint) {
      throw new AppError('WEBHOOK_NOT_FOUND', 'Webhook endpoint not found.', 404);
    }
    return endpoint;
  }
}
