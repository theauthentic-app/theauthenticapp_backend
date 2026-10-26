import { Injectable } from '@nestjs/common';
import { Prisma, VerificationStatus } from '@prisma/client';
import { BillingService } from '../billing/billing.service';
import { PrismaService } from '../database/prisma.service';

export type DashboardFilters = {
  days?: number;
  from?: string;
  to?: string;
  productId?: string;
  batchId?: string;
};

@Injectable()
export class AnalyticsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly billing: BillingService,
  ) {}

  async dashboard(organizationId: string, filters: DashboardFilters = {}) {
    const to = filters.to ? new Date(filters.to) : new Date();
    const from = filters.from
      ? new Date(filters.from)
      : new Date(to.getTime() - (filters.days ?? 30) * 86_400_000);
    const identityScope = await this.identityScope(
      organizationId,
      filters.productId,
      filters.batchId,
    );
    const verifyWhere: Prisma.VerificationWhereInput = {
      createdAt: { gte: from, lte: to },
      productIdentity: identityScope,
    };
    const todayStart = new Date(Date.now() - 86_400_000);

    const [
      products,
      identities,
      active,
      reports,
      statusGroups,
      cityGroups,
      scansToday,
      recent,
      topProducts,
      failedWebhooks,
      billing,
      trend,
    ] = await Promise.all([
      this.prisma.product.count({ where: { organizationId } }),
      this.prisma.productIdentity.count({ where: identityScope }),
      this.prisma.productIdentity.count({
        where: { ...identityScope, status: 'ACTIVE' },
      }),
      this.prisma.productReport.count({
        where: { productIdentity: identityScope },
      }),
      this.prisma.verification.groupBy({
        by: ['status'],
        where: verifyWhere,
        _count: { _all: true },
      }),
      this.prisma.verification.groupBy({
        by: ['city'],
        where: verifyWhere,
        _count: { _all: true },
        orderBy: { _count: { city: 'desc' } },
        take: 12,
      }),
      this.prisma.verification.count({
        where: {
          createdAt: { gte: todayStart },
          productIdentity: identityScope,
        },
      }),
      this.prisma.verification.findMany({
        where: verifyWhere,
        include: {
          productIdentity: {
            include: { productVariant: { include: { product: true } } },
          },
        },
        orderBy: { createdAt: 'desc' },
        take: 20,
      }),
      this.topProducts(organizationId, from, to),
      this.prisma.webhookDelivery.count({
        where: {
          status: 'FAILED',
          endpoint: { organizationId },
          createdAt: { gte: from, lte: to },
        },
      }),
      this.billing.snapshot(organizationId),
      this.dailyTrend(organizationId, from, to, filters),
    ]);

    const countOf = (status: VerificationStatus) =>
      statusGroups.find((row) => row.status === status)?._count._all ?? 0;
    const verified = countOf(VerificationStatus.AUTHENTICATED);
    const suspicious = countOf(VerificationStatus.SUSPICIOUS);
    const alerts =
      countOf(VerificationStatus.COMPROMISED) +
      countOf(VerificationStatus.RECALLED) +
      countOf(VerificationStatus.REVOKED);
    const totalScans = statusGroups.reduce((n, row) => n + row._count._all, 0);

    return {
      range: { from, to },
      products,
      units: identities,
      active,
      reports,
      verified,
      suspicious,
      alerts,
      totalScans,
      scansToday,
      failedWebhooks,
      cities: Object.fromEntries(
        cityGroups.map((row) => [row.city ?? 'Unknown', row._count._all]),
      ),
      topProducts,
      trend,
      quota: billing.remaining,
      plan: {
        code: billing.plan.code,
        name: billing.plan.name,
        status: billing.status,
      },
      recent: recent.map((event) => ({
        id: event.publicId,
        status: event.status,
        city: event.city,
        country: event.country,
        createdAt: event.createdAt,
        unit: {
          authenticId: event.productIdentity?.publicId,
          product: {
            name: event.productIdentity?.productVariant.product.name,
          },
        },
      })),
    };
  }

  private async identityScope(
    organizationId: string,
    productPublicId?: string,
    batchPublicId?: string,
  ): Promise<Prisma.ProductIdentityWhereInput> {
    const where: Prisma.ProductIdentityWhereInput = { organizationId };
    if (productPublicId) {
      const product = await this.prisma.product.findFirst({
        where: { organizationId, publicId: productPublicId },
        select: { id: true },
      });
      where.productVariant = { productId: product?.id ?? '__none__' };
    }
    if (batchPublicId) {
      const batch = await this.prisma.batch.findFirst({
        where: { organizationId, publicId: batchPublicId },
        select: { id: true },
      });
      where.batchId = batch?.id ?? '__none__';
    }
    return where;
  }

  private async topProducts(organizationId: string, from: Date, to: Date) {
    const rows = await this.prisma.$queryRaw<
      Array<{ productId: string; name: string; scans: bigint; alerts: bigint }>
    >`
      SELECT p."publicId" AS "productId", p.name,
             COUNT(v.id)::bigint AS scans,
             COUNT(*) FILTER (
               WHERE v.status IN ('COMPROMISED', 'RECALLED', 'REVOKED', 'SUSPICIOUS')
             )::bigint AS alerts
      FROM "Verification" v
      JOIN "ProductIdentity" i ON i.id = v."productIdentityId"
      JOIN "ProductVariant" pv ON pv.id = i."productVariantId"
      JOIN "Product" p ON p.id = pv."productId"
      WHERE i."organizationId" = ${organizationId}
        AND v."createdAt" >= ${from}
        AND v."createdAt" <= ${to}
      GROUP BY p."publicId", p.name
      ORDER BY scans DESC
      LIMIT 8
    `;
    return rows.map((row) => ({
      productId: row.productId,
      name: row.name,
      scans: Number(row.scans),
      alerts: Number(row.alerts),
    }));
  }

  private async dailyTrend(
    organizationId: string,
    from: Date,
    to: Date,
    filters: DashboardFilters,
  ) {
    const productClause = filters.productId
      ? Prisma.sql`AND p."publicId" = ${filters.productId}`
      : Prisma.empty;
    const batchClause = filters.batchId
      ? Prisma.sql`AND b."publicId" = ${filters.batchId}`
      : Prisma.empty;
    const rows = await this.prisma.$queryRaw<
      Array<{ day: Date; scans: bigint; alerts: bigint }>
    >`
      SELECT date_trunc('day', v."createdAt") AS day,
             COUNT(v.id)::bigint AS scans,
             COUNT(*) FILTER (
               WHERE v.status IN ('COMPROMISED', 'RECALLED', 'REVOKED', 'SUSPICIOUS')
             )::bigint AS alerts
      FROM "Verification" v
      JOIN "ProductIdentity" i ON i.id = v."productIdentityId"
      JOIN "ProductVariant" pv ON pv.id = i."productVariantId"
      JOIN "Product" p ON p.id = pv."productId"
      JOIN "Batch" b ON b.id = i."batchId"
      WHERE i."organizationId" = ${organizationId}
        AND v."createdAt" >= ${from}
        AND v."createdAt" <= ${to}
        ${productClause}
        ${batchClause}
      GROUP BY 1
      ORDER BY 1 ASC
    `;
    return rows.map((row) => ({
      day: row.day,
      scans: Number(row.scans),
      alerts: Number(row.alerts),
    }));
  }
}
