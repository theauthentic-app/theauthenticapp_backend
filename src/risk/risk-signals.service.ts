import { Injectable } from '@nestjs/common';
import { Prisma, RiskSeverity, RiskType } from '@prisma/client';
import {
  paginatedResult,
  paginationOf,
  type PaginationInput,
} from '../common/utils/pagination.util';
import { PrismaService } from '../database/prisma.service';

@Injectable()
export class RiskSignalsService {
  constructor(private readonly prisma: PrismaService) {}

  async listForOrganization(
    organizationId: string,
    query?: PaginationInput & { severity?: RiskSeverity; type?: RiskType },
  ) {
    const { page, limit, skip, take } = paginationOf(query);
    const where: Prisma.RiskSignalWhereInput = {
      OR: [
        { productIdentity: { organizationId } },
        { verification: { productIdentity: { organizationId } } },
      ],
    };
    if (query?.severity) where.severity = query.severity;
    if (query?.type) where.type = query.type;

    const [rows, total] = await this.prisma.$transaction([
      this.prisma.riskSignal.findMany({
        where,
        include: {
          productIdentity: { select: { publicId: true } },
          verification: { select: { publicId: true, status: true } },
        },
        orderBy: { detectedAt: 'desc' },
        skip,
        take,
      }),
      this.prisma.riskSignal.count({ where }),
    ]);

    return paginatedResult(
      rows.map((row) => ({
        id: row.id,
        type: row.type,
        severity: row.severity,
        scoreImpact: row.scoreImpact,
        evidence: row.evidence,
        detectedAt: row.detectedAt,
        identityId: row.productIdentity?.publicId ?? null,
        verificationId: row.verification.publicId,
        verificationStatus: row.verification.status,
      })),
      total,
      page,
      limit,
    );
  }
}
