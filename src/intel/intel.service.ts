import { Injectable } from '@nestjs/common';
import { PrismaService } from '../database/prisma.service';

@Injectable()
export class IntelService {
  constructor(private readonly prisma: PrismaService) {}

  /**
   * Counterfeit intel is evidence aggregation — never labeled as a legal
   * determination that a physical good is fake.
   */
  async counterfeit(organizationId: string, days = 30) {
    const to = new Date();
    const from = new Date(to.getTime() - days * 86_400_000);
    const identityScope = { organizationId };

    const [
      counterfeitReports,
      openCounterfeit,
      compromisedScans,
      suspiciousScans,
      cloneSignals,
      byCity,
      recentReports,
      recentCompromised,
    ] = await Promise.all([
      this.prisma.productReport.count({
        where: {
          reason: 'COUNTERFEIT',
          productIdentity: identityScope,
          createdAt: { gte: from, lte: to },
        },
      }),
      this.prisma.productReport.count({
        where: {
          reason: 'COUNTERFEIT',
          productIdentity: identityScope,
          status: { in: ['OPEN', 'UNDER_REVIEW'] },
        },
      }),
      this.prisma.verification.count({
        where: {
          status: 'COMPROMISED',
          createdAt: { gte: from, lte: to },
          productIdentity: identityScope,
        },
      }),
      this.prisma.verification.count({
        where: {
          status: 'SUSPICIOUS',
          createdAt: { gte: from, lte: to },
          productIdentity: identityScope,
        },
      }),
      this.prisma.riskSignal.count({
        where: {
          type: 'DUPLICATE_CREDENTIAL',
          detectedAt: { gte: from, lte: to },
          OR: [
            { productIdentity: identityScope },
            { verification: { productIdentity: identityScope } },
          ],
        },
      }),
      this.prisma.productReport.groupBy({
        by: ['city'],
        where: {
          reason: 'COUNTERFEIT',
          productIdentity: identityScope,
          createdAt: { gte: from, lte: to },
        },
        _count: { _all: true },
        orderBy: { _count: { city: 'desc' } },
        take: 10,
      }),
      this.prisma.productReport.findMany({
        where: {
          reason: 'COUNTERFEIT',
          productIdentity: identityScope,
        },
        orderBy: { createdAt: 'desc' },
        take: 15,
        select: {
          publicId: true,
          status: true,
          city: true,
          country: true,
          description: true,
          createdAt: true,
          productIdentity: { select: { publicId: true } },
        },
      }),
      this.prisma.verification.findMany({
        where: {
          status: { in: ['COMPROMISED', 'SUSPICIOUS'] },
          createdAt: { gte: from, lte: to },
          productIdentity: identityScope,
        },
        orderBy: { createdAt: 'desc' },
        take: 15,
        select: {
          publicId: true,
          status: true,
          city: true,
          country: true,
          createdAt: true,
          productIdentity: { select: { publicId: true } },
        },
      }),
    ]);

    const heatScore = Math.min(
      100,
      counterfeitReports * 8 +
        compromisedScans * 12 +
        cloneSignals * 10 +
        suspiciousScans * 3,
    );

    return {
      meta: {
        audience: 'manufacturer',
        range: { from, to, days },
        disclaimer:
          'AUTHENTIC surfaces digital evidence and reports. It does not declare physical goods original or counterfeit.',
        generatedAt: new Date().toISOString(),
      },
      summary: {
        counterfeitReports,
        openCounterfeit,
        compromisedScans,
        suspiciousScans,
        cloneSignals,
        heatScore,
      },
      geo: {
        cities: Object.fromEntries(
          byCity.map((row) => [row.city ?? 'Unknown', row._count._all]),
        ),
      },
      recentReports: recentReports.map((r) => ({
        id: r.publicId,
        status: r.status,
        city: r.city,
        country: r.country,
        description: r.description,
        createdAt: r.createdAt,
        identityId: r.productIdentity?.publicId ?? null,
      })),
      recentRiskScans: recentCompromised.map((v) => ({
        id: v.publicId,
        status: v.status,
        city: v.city,
        country: v.country,
        createdAt: v.createdAt,
        identityId: v.productIdentity?.publicId ?? null,
      })),
      suggestedActions: [
        openCounterfeit > 0
          ? {
              code: 'TRIAGE_REPORTS',
              label: 'Triage counterfeit reports',
              href: '/reports?reason=COUNTERFEIT',
            }
          : null,
        cloneSignals > 0
          ? {
              code: 'REVIEW_CLONES',
              label: 'Review duplicate-credential signals',
              href: '/risk-signals?type=DUPLICATE_CREDENTIAL',
            }
          : null,
        {
          code: 'ISSUE_RECALL',
          label: 'Open recall center',
          href: '/recalls',
        },
      ].filter(Boolean),
    };
  }
}
