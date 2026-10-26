import { Injectable } from '@nestjs/common';
import { SupplyChainEventType } from '@prisma/client';
import { AppError } from '../common/errors/app-error';
import { PrismaService } from '../database/prisma.service';
import {
  paginatedResult,
  paginationOf,
  type PaginationInput,
} from '../common/utils/pagination.util';

@Injectable()
export class SupplyChainService {
  constructor(private readonly prisma: PrismaService) {}

  async record(
    organizationId: string,
    input: {
      identityId: string;
      type: SupplyChainEventType;
      location?: string;
    },
  ) {
    const identity = await this.prisma.productIdentity.findFirst({
      where: { publicId: input.identityId },
    });
    if (!identity)
      throw new AppError(
        'IDENTITY_NOT_FOUND',
        'Product identity not found.',
        404,
      );
    const event = await this.prisma.supplyChainEvent.create({
      data: {
        productIdentityId: identity.id,
        organizationId,
        type: input.type,
        location: input.location,
      },
    });
    if (input.type === 'RECEIVED') {
      await this.prisma.inventoryItem.upsert({
        where: {
          organizationId_productIdentityId: {
            organizationId,
            productIdentityId: identity.id,
          },
        },
        update: { scannedAt: new Date(), location: input.location },
        create: {
          organizationId,
          productIdentityId: identity.id,
          location: input.location,
        },
      });
    }
    return { id: event.id, type: event.type };
  }

  async list(organizationId: string, query?: PaginationInput) {
    const { page, limit, skip, take } = paginationOf(query);
    const where = { organizationId };
    const [events, total] = await this.prisma.$transaction([
      this.prisma.supplyChainEvent.findMany({
        where,
        include: {
          productIdentity: {
            include: { productVariant: { include: { product: true } } },
          },
        },
        orderBy: { occurredAt: 'desc' },
        skip,
        take,
      }),
      this.prisma.supplyChainEvent.count({ where }),
    ]);
    return paginatedResult(
      events.map((event) => ({
        id: event.id,
        type: event.type,
        location: event.location,
        occurredAt: event.occurredAt,
        identityId: event.productIdentity.publicId,
        productName: event.productIdentity.productVariant.product.name,
      })),
      total,
      page,
      limit,
    );
  }
}
