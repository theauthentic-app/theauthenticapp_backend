import { Injectable } from '@nestjs/common';
import { AuditAction, Prisma } from '@prisma/client';
import { PrismaService } from '../database/prisma.service';

@Injectable()
export class AuditService {
  constructor(private readonly prisma: PrismaService) {}

  async record(input: {
    action: AuditAction;
    actorUserId?: string;
    organizationId?: string;
    entity: string;
    entityId?: string;
    metadata?: Record<string, unknown>;
  }) {
    return this.prisma.auditLog.create({
      data: {
        action: input.action,
        actorUserId: input.actorUserId,
        organizationId: input.organizationId,
        entity: input.entity,
        entityId: input.entityId,
        metadata:
          (input.metadata as Prisma.InputJsonValue | undefined) ?? undefined,
      },
    });
  }
}
