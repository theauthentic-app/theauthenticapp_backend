import { Injectable } from '@nestjs/common';
import { WarrantyStatus } from '@prisma/client';
import { AppError } from '../common/errors/app-error';
import { publicId } from '../common/utils/crypto.util';
import { PrismaService } from '../database/prisma.service';
import {
  paginatedResult,
  paginationOf,
  type PaginationInput,
} from '../common/utils/pagination.util';

@Injectable()
export class WarrantiesService {
  constructor(private readonly prisma: PrismaService) {}

  async register(userId: string, identityPublicId: string, months = 12) {
    const identity = await this.prisma.productIdentity.findUnique({
      where: { publicId: identityPublicId },
    });
    if (!identity)
      throw new AppError(
        'IDENTITY_NOT_FOUND',
        'Product identity not found.',
        404,
      );
    const startDate = new Date();
    const endDate = new Date(startDate);
    endDate.setMonth(endDate.getMonth() + months);
    const warranty = await this.prisma.warranty.create({
      data: {
        publicId: publicId('wty'),
        productIdentityId: identity.id,
        organizationId: identity.organizationId,
        ownerUserId: userId,
        startDate,
        endDate,
        status: WarrantyStatus.ACTIVE,
      },
    });
    return {
      id: warranty.publicId,
      status: warranty.status,
      startDate,
      endDate,
    };
  }

  async listForOrganization(
    organizationId: string,
    query?: PaginationInput,
  ) {
    const { page, limit, skip, take } = paginationOf(query);
    const where = { organizationId };
    const [items, total] = await this.prisma.$transaction([
      this.prisma.warranty.findMany({
        where,
        include: {
          productIdentity: {
            include: { productVariant: { include: { product: true } } },
          },
        },
        orderBy: { createdAt: 'desc' },
        skip,
        take,
      }),
      this.prisma.warranty.count({ where }),
    ]);
    return paginatedResult(
      items.map((item) => ({
        id: item.publicId,
        status: item.status,
        startDate: item.startDate,
        endDate: item.endDate,
        identityId: item.productIdentity.publicId,
        productName: item.productIdentity.productVariant.product.name,
      })),
      total,
      page,
      limit,
    );
  }
}
