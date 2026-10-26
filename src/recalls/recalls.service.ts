import { Injectable } from '@nestjs/common';
import { IdentityStatus, RecallSeverity } from '@prisma/client';
import { AuditService } from '../audit/audit.service';
import { normalizeCode, publicId } from '../common/utils/crypto.util';
import { PrismaService } from '../database/prisma.service';
import { RedisService } from '../redis/redis.service';
import {
  paginatedResult,
  paginationOf,
  type PaginationInput,
} from '../common/utils/pagination.util';
import { NotificationsService } from '../notifications/notifications.service';

@Injectable()
export class RecallsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
    private readonly redis: RedisService,
    private readonly notifications: NotificationsService,
  ) {}

  async create(
    organizationId: string,
    actorUserId: string | undefined,
    input: {
      recallNumber: string;
      reason: string;
      instructions?: string;
      severity: RecallSeverity;
      startDate: string;
      batchIds?: string[];
    },
  ) {
    const recall = await this.prisma.recall.create({
      data: {
        publicId: publicId('rcl'),
        organizationId,
        recallNumber: input.recallNumber,
        reason: input.reason,
        instructions: input.instructions,
        severity: input.severity,
        startDate: new Date(input.startDate),
        status: 'ACTIVE',
      },
    });

    if (input.batchIds?.length) {
      const batches = await this.prisma.batch.findMany({
        where: { organizationId, publicId: { in: input.batchIds } },
      });
      await this.prisma.recallBatch.createMany({
        data: batches.map((b) => ({ recallId: recall.id, batchId: b.id })),
      });
      await this.prisma.batch.updateMany({
        where: { id: { in: batches.map((b) => b.id) } },
        data: { status: 'RECALLED' },
      });
      await this.prisma.productIdentity.updateMany({
        where: { batchId: { in: batches.map((b) => b.id) } },
        data: { status: IdentityStatus.RECALLED },
      });
      for (const identity of await this.prisma.productIdentity.findMany({
        where: { batchId: { in: batches.map((b) => b.id) } },
        select: { publicId: true },
      })) {
        await this.redis.del(`verify:${normalizeCode(identity.publicId)}`);
      }
    }

    await this.audit.record({
      action: 'RECALL_CREATED',
      actorUserId,
      organizationId,
      entity: 'Recall',
      entityId: recall.id,
    });
    this.notifications.notifyOrganizationSafe(organizationId, {
      subject: `Recall ${recall.recallNumber} is active`,
      template: 'recall-created',
      context: {
        recallNumber: recall.recallNumber,
        reason: recall.reason,
        instructions: recall.instructions,
        severity: recall.severity,
        batchCount: input.batchIds?.length ?? 0,
      },
    });
    return {
      id: recall.publicId,
      recallNumber: recall.recallNumber,
      status: recall.status,
    };
  }

  async list(organizationId: string, query?: PaginationInput) {
    const { page, limit, skip, take } = paginationOf(query);
    const where = { organizationId };
    const [recalls, total] = await this.prisma.$transaction([
      this.prisma.recall.findMany({
        where,
        include: { batches: true },
        orderBy: { createdAt: 'desc' },
        skip,
        take,
      }),
      this.prisma.recall.count({ where }),
    ]);
    return paginatedResult(
      recalls.map((recall) => ({
        id: recall.publicId,
        recallNumber: recall.recallNumber,
        reason: recall.reason,
        instructions: recall.instructions,
        severity: recall.severity,
        status: recall.status,
        startDate: recall.startDate,
        createdAt: recall.createdAt,
        affectedBatches: recall.batches.length,
      })),
      total,
      page,
      limit,
    );
  }
}
