import { Injectable } from '@nestjs/common';
import { ReportReason } from '@prisma/client';
import { normalizeCode, publicId, sha256 } from '../common/utils/crypto.util';
import { PrismaService } from '../database/prisma.service';
import {
  paginatedResult,
  paginationOf,
  type PaginationInput,
} from '../common/utils/pagination.util';

@Injectable()
export class ReportsService {
  constructor(private readonly prisma: PrismaService) {}

  async create(input: {
    userId?: string;
    reason: ReportReason;
    description?: string;
    code?: string;
    city?: string;
    country?: string;
  }) {
    let productIdentityId: string | undefined;
    if (input.code) {
      const cred = await this.prisma.credential.findFirst({
        where: { valueHash: sha256(normalizeCode(input.code)) },
      });
      productIdentityId = cred?.productIdentityId;
    }
    const report = await this.prisma.productReport.create({
      data: {
        publicId: publicId('rpt'),
        userId: input.userId,
        reason: input.reason,
        description: input.description,
        city: input.city,
        country: input.country,
        productIdentityId,
      },
    });
    return { id: report.publicId, status: report.status };
  }

  async listForOrganization(
    organizationId: string,
    query?: PaginationInput,
  ) {
    const { page, limit, skip, take } = paginationOf(query);
    const where = { productIdentity: { organizationId } };
    const [reports, total] = await this.prisma.$transaction([
      this.prisma.productReport.findMany({
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
      this.prisma.productReport.count({ where }),
    ]);
    return paginatedResult(
      reports.map((report) => ({
        id: report.publicId,
        reason: report.reason,
        status: report.status,
        description: report.description,
        city: report.city,
        country: report.country,
        createdAt: report.createdAt,
        identityId: report.productIdentity?.publicId,
        productName: report.productIdentity?.productVariant.product.name,
      })),
      total,
      page,
      limit,
    );
  }
}
