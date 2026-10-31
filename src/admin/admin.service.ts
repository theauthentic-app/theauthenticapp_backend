import { Injectable } from '@nestjs/common';
import { PLANS } from '../billing/plans';
import { PrismaService } from '../database/prisma.service';

export type AdminDashboardFilters = {
  days?: number;
  from?: string;
  to?: string;
};

@Injectable()
export class AdminService {
  constructor(private readonly prisma: PrismaService) {}

  async dashboard(filters: AdminDashboardFilters = {}) {
    const to = filters.to ? new Date(filters.to) : new Date();
    const from = filters.from
      ? new Date(filters.from)
      : new Date(to.getTime() - (filters.days ?? 30) * 86_400_000);
    const prevMs = to.getTime() - from.getTime();
    const prevFrom = new Date(from.getTime() - Math.max(prevMs, 86_400_000));
    const prevTo = from;

    const [
      users,
      usersPrev,
      usersVerified,
      organizations,
      orgsPrev,
      orgsPending,
      orgsActive,
      orgsSuspended,
      identities,
      verifications,
      verificationsPrev,
      reports,
      reportsOpen,
      paymentsSuccess,
      paymentsFailed,
      revenueAgg,
      revenuePrevAgg,
      lockedUsers,
      failedWebhooks,
      subscribersActive,
      growthUsers,
      growthOrgs,
      growthScans,
      revenueDaily,
      revenueByPlan,
      geoCountries,
      geoCities,
      statusFunnelScans,
      reportsByReason,
      recentOrgs,
      recentReports,
      recentPayments,
      planMix,
    ] = await Promise.all([
      this.prisma.user.count(),
      this.prisma.user.count({
        where: { createdAt: { gte: prevFrom, lt: prevTo } },
      }),
      this.prisma.user.count({ where: { emailVerifiedAt: { not: null } } }),
      this.prisma.organization.count(),
      this.prisma.organization.count({
        where: { createdAt: { gte: prevFrom, lt: prevTo } },
      }),
      this.prisma.organization.count({ where: { status: 'PENDING' } }),
      this.prisma.organization.count({ where: { status: 'ACTIVE' } }),
      this.prisma.organization.count({ where: { status: 'SUSPENDED' } }),
      this.prisma.productIdentity.count(),
      this.prisma.verification.count({
        where: { createdAt: { gte: from, lte: to } },
      }),
      this.prisma.verification.count({
        where: { createdAt: { gte: prevFrom, lt: prevTo } },
      }),
      this.prisma.productReport.count({
        where: { createdAt: { gte: from, lte: to } },
      }),
      this.prisma.productReport.count({
        where: { status: { in: ['OPEN', 'UNDER_REVIEW'] } },
      }),
      this.prisma.payment.count({
        where: {
          status: 'SUCCESS',
          paidAt: { gte: from, lte: to },
        },
      }),
      this.prisma.payment.count({
        where: {
          status: { in: ['FAILED', 'ABANDONED'] },
          createdAt: { gte: from, lte: to },
        },
      }),
      this.prisma.payment.aggregate({
        where: { status: 'SUCCESS', paidAt: { gte: from, lte: to } },
        _sum: { amountKobo: true },
      }),
      this.prisma.payment.aggregate({
        where: { status: 'SUCCESS', paidAt: { gte: prevFrom, lt: prevTo } },
        _sum: { amountKobo: true },
      }),
      this.prisma.user.count({ where: { status: 'LOCKED' } }),
      this.prisma.webhookDelivery.count({
        where: { status: 'FAILED', createdAt: { gte: from, lte: to } },
      }),
      this.prisma.subscription.count({
        where: { status: { in: ['ACTIVE', 'TRIAL'] } },
      }),
      this.dailyUserCounts(from, to),
      this.dailyOrgCounts(from, to),
      this.dailyVerificationCounts(from, to),
      this.dailyRevenue(from, to),
      this.prisma.payment.groupBy({
        by: ['planCode'],
        where: { status: 'SUCCESS', paidAt: { gte: from, lte: to } },
        _sum: { amountKobo: true },
        _count: { _all: true },
      }),
      this.prisma.verification.groupBy({
        by: ['country'],
        where: { createdAt: { gte: from, lte: to } },
        _count: { _all: true },
        orderBy: { _count: { country: 'desc' } },
        take: 15,
      }),
      this.prisma.verification.groupBy({
        by: ['city'],
        where: { createdAt: { gte: from, lte: to } },
        _count: { _all: true },
        orderBy: { _count: { city: 'desc' } },
        take: 15,
      }),
      this.prisma.verification.groupBy({
        by: ['status'],
        where: { createdAt: { gte: from, lte: to } },
        _count: { _all: true },
      }),
      this.prisma.productReport.groupBy({
        by: ['reason'],
        where: { createdAt: { gte: from, lte: to } },
        _count: { _all: true },
      }),
      this.prisma.organization.findMany({
        orderBy: { createdAt: 'desc' },
        take: 12,
        include: { subscription: true },
      }),
      this.prisma.productReport.findMany({
        orderBy: { createdAt: 'desc' },
        take: 12,
        select: {
          publicId: true,
          reason: true,
          status: true,
          city: true,
          country: true,
          createdAt: true,
        },
      }),
      this.prisma.payment.findMany({
        where: { createdAt: { gte: from, lte: to } },
        orderBy: { createdAt: 'desc' },
        take: 12,
        select: {
          reference: true,
          status: true,
          planCode: true,
          amountKobo: true,
          currency: true,
          paidAt: true,
          createdAt: true,
          organization: { select: { publicId: true, name: true } },
        },
      }),
      this.prisma.subscription.groupBy({
        by: ['planCode', 'status'],
        _count: { _all: true },
      }),
    ]);

    const usersInRange = await this.prisma.user.count({
      where: { createdAt: { gte: from, lte: to } },
    });
    const orgsInRange = await this.prisma.organization.count({
      where: { createdAt: { gte: from, lte: to } },
    });
    const membersWithOrg = await this.prisma.organizationMember.groupBy({
      by: ['userId'],
    });
    const usersWithOrg = membersWithOrg.length;
    const orgsWithScan = await this.prisma.$queryRaw<Array<{ n: bigint }>>`
      SELECT COUNT(DISTINCT i."organizationId")::bigint AS n
      FROM "Verification" v
      JOIN "ProductIdentity" i ON i.id = v."productIdentityId"
      WHERE v."createdAt" >= ${from} AND v."createdAt" <= ${to}
    `;

    const revenueKobo = revenueAgg._sum.amountKobo ?? 0;
    const revenuePrevKobo = revenuePrevAgg._sum.amountKobo ?? 0;
    const revenueGrowthPct =
      revenuePrevKobo === 0
        ? revenueKobo > 0
          ? 100
          : 0
        : Math.round(((revenueKobo - revenuePrevKobo) / revenuePrevKobo) * 1000) /
          10;

    const mrrEstimateKobo = await this.estimateMrrKobo();

    const funnel = {
      registeredUsers: users,
      emailVerifiedUsers: usersVerified,
      usersInOrganization: usersWithOrg,
      activeOrTrialSubscribers: subscribersActive,
      orgsWithScansInRange: Number(orgsWithScan[0]?.n ?? 0),
      rates: {
        emailVerifyRate:
          users === 0
            ? null
            : Math.round((usersVerified / users) * 1000) / 10,
        orgAttachRate:
          users === 0
            ? null
            : Math.round((usersWithOrg / users) * 1000) / 10,
        subscriberRate:
          organizations === 0
            ? null
            : Math.round((subscribersActive / organizations) * 1000) / 10,
      },
    };

    const scanStatus = Object.fromEntries(
      statusFunnelScans.map((row) => [row.status, row._count._all]),
    );

    const alerts = this.buildAlerts({
      orgsPending,
      orgsSuspended,
      reportsOpen,
      failedWebhooks,
      lockedUsers,
      paymentsFailed,
      revenueGrowthPct,
    });

    return {
      meta: {
        audience: 'platform_admin',
        range: { from, to },
        previousRange: { from: prevFrom, to: prevTo },
        generatedAt: new Date().toISOString(),
      },
      summary: {
        users,
        usersInRange,
        userGrowthPct: this.pctChange(usersInRange, usersPrev),
        organizations,
        orgsInRange,
        orgGrowthPct: this.pctChange(orgsInRange, orgsPrev),
        identities,
        verificationsInRange: verifications,
        verificationGrowthPct: this.pctChange(verifications, verificationsPrev),
        reportsInRange: reports,
        reportsOpen,
        orgsPending,
        orgsActive,
        orgsSuspended,
        lockedUsers,
        subscribersActive,
        revenueKobo,
        revenueNgn: revenueKobo / 100,
        revenueGrowthPct,
        mrrEstimateKobo,
        mrrEstimateNgn: mrrEstimateKobo / 100,
        successfulPayments: paymentsSuccess,
        failedPayments: paymentsFailed,
      },
      growth: {
        users: growthUsers,
        organizations: growthOrgs,
        scans: growthScans,
      },
      revenue: {
        totalKobo: revenueKobo,
        totalNgn: revenueKobo / 100,
        currency: 'NGN',
        growthPct: revenueGrowthPct,
        mrrEstimateKobo,
        mrrEstimateNgn: mrrEstimateKobo / 100,
        daily: revenueDaily,
        byPlan: revenueByPlan.map((row) => ({
          planCode: row.planCode,
          count: row._count._all,
          amountKobo: row._sum.amountKobo ?? 0,
          amountNgn: (row._sum.amountKobo ?? 0) / 100,
          listPriceNgn: PLANS[row.planCode as keyof typeof PLANS]?.monthlyNgn ?? null,
        })),
        recent: recentPayments.map((p) => ({
          reference: p.reference,
          status: p.status,
          planCode: p.planCode,
          amountKobo: p.amountKobo,
          amountNgn: p.amountKobo / 100,
          currency: p.currency,
          paidAt: p.paidAt,
          createdAt: p.createdAt,
          organization: p.organization,
        })),
        planMix: planMix.map((row) => ({
          planCode: row.planCode,
          status: row.status,
          count: row._count._all,
        })),
      },
      geo: {
        countries: Object.fromEntries(
          geoCountries.map((row) => [row.country ?? 'Unknown', row._count._all]),
        ),
        cities: Object.fromEntries(
          geoCities.map((row) => [row.city ?? 'Unknown', row._count._all]),
        ),
      },
      funnel,
      scanMix: {
        byStatus: scanStatus,
        authenticated: scanStatus.AUTHENTICATED ?? 0,
        risk:
          (scanStatus.SUSPICIOUS ?? 0) +
          (scanStatus.COMPROMISED ?? 0) +
          (scanStatus.RECALLED ?? 0) +
          (scanStatus.REVOKED ?? 0),
      },
      kyc: {
        pending: orgsPending,
        active: orgsActive,
        suspended: orgsSuspended,
        recent: recentOrgs.map((org) => ({
          id: org.publicId,
          name: org.name,
          status: org.status,
          plan: org.subscription?.planCode,
          subscriptionStatus: org.subscription?.status,
          createdAt: org.createdAt,
        })),
      },
      reports: {
        open: reportsOpen,
        inRange: reports,
        byReason: Object.fromEntries(
          reportsByReason.map((row) => [row.reason, row._count._all]),
        ),
        recent: recentReports.map((r) => ({
          id: r.publicId,
          reason: r.reason,
          status: r.status,
          city: r.city,
          country: r.country,
          createdAt: r.createdAt,
        })),
      },
      health: {
        failedWebhooks,
        lockedUsers,
        failedPayments: paymentsFailed,
      },
      alerts,
      suggestedActions: this.suggestedActions(alerts),
    };
  }

  private pctChange(current: number, previous: number) {
    if (previous === 0) return current > 0 ? 100 : 0;
    return Math.round(((current - previous) / previous) * 1000) / 10;
  }

  private async estimateMrrKobo() {
    const subs = await this.prisma.subscription.findMany({
      where: { status: { in: ['ACTIVE', 'TRIAL'] } },
      select: { planCode: true, status: true },
    });
    let kobo = 0;
    for (const sub of subs) {
      if (sub.status === 'TRIAL') continue;
      const plan = PLANS[sub.planCode as keyof typeof PLANS];
      if (plan?.monthlyNgn != null) kobo += plan.monthlyNgn * 100;
    }
    return kobo;
  }

  private async dailyUserCounts(from: Date, to: Date) {
    const rows = await this.prisma.$queryRaw<
      Array<{ day: Date; count: bigint }>
    >`
      SELECT date_trunc('day', "createdAt") AS day, COUNT(*)::bigint AS count
      FROM "User"
      WHERE "createdAt" >= ${from} AND "createdAt" <= ${to}
      GROUP BY 1
      ORDER BY 1 ASC
    `;
    return rows.map((row) => ({ day: row.day, count: Number(row.count) }));
  }

  private async dailyOrgCounts(from: Date, to: Date) {
    const rows = await this.prisma.$queryRaw<
      Array<{ day: Date; count: bigint }>
    >`
      SELECT date_trunc('day', "createdAt") AS day, COUNT(*)::bigint AS count
      FROM "Organization"
      WHERE "createdAt" >= ${from} AND "createdAt" <= ${to}
      GROUP BY 1
      ORDER BY 1 ASC
    `;
    return rows.map((row) => ({ day: row.day, count: Number(row.count) }));
  }

  private async dailyVerificationCounts(from: Date, to: Date) {
    const rows = await this.prisma.$queryRaw<
      Array<{ day: Date; scans: bigint; alerts: bigint }>
    >`
      SELECT date_trunc('day', "createdAt") AS day,
             COUNT(*)::bigint AS scans,
             COUNT(*) FILTER (
               WHERE status IN ('COMPROMISED', 'RECALLED', 'REVOKED', 'SUSPICIOUS')
             )::bigint AS alerts
      FROM "Verification"
      WHERE "createdAt" >= ${from} AND "createdAt" <= ${to}
      GROUP BY 1
      ORDER BY 1 ASC
    `;
    return rows.map((row) => ({
      day: row.day,
      scans: Number(row.scans),
      alerts: Number(row.alerts),
    }));
  }

  private async dailyRevenue(from: Date, to: Date) {
    const rows = await this.prisma.$queryRaw<
      Array<{ day: Date; amountKobo: bigint; count: bigint }>
    >`
      SELECT date_trunc('day', COALESCE("paidAt", "createdAt")) AS day,
             COALESCE(SUM("amountKobo") FILTER (WHERE status = 'SUCCESS'), 0)::bigint AS "amountKobo",
             COUNT(*) FILTER (WHERE status = 'SUCCESS')::bigint AS count
      FROM "Payment"
      WHERE COALESCE("paidAt", "createdAt") >= ${from}
        AND COALESCE("paidAt", "createdAt") <= ${to}
      GROUP BY 1
      ORDER BY 1 ASC
    `;
    return rows.map((row) => ({
      day: row.day,
      amountKobo: Number(row.amountKobo),
      amountNgn: Number(row.amountKobo) / 100,
      count: Number(row.count),
    }));
  }

  private buildAlerts(input: {
    orgsPending: number;
    orgsSuspended: number;
    reportsOpen: number;
    failedWebhooks: number;
    lockedUsers: number;
    paymentsFailed: number;
    revenueGrowthPct: number;
  }) {
    const alerts: Array<{
      severity: 'info' | 'warning' | 'critical';
      code: string;
      title: string;
      detail: string;
    }> = [];
    if (input.orgsPending > 0) {
      alerts.push({
        severity: 'warning',
        code: 'KYC_BACKLOG',
        title: 'KYC backlog',
        detail: `${input.orgsPending} organization(s) awaiting approval.`,
      });
    }
    if (input.reportsOpen > 20) {
      alerts.push({
        severity: 'warning',
        code: 'REPORT_BACKLOG',
        title: 'Consumer report backlog',
        detail: `${input.reportsOpen} open reports across the platform.`,
      });
    }
    if (input.failedWebhooks > 50) {
      alerts.push({
        severity: 'warning',
        code: 'WEBHOOK_NOISE',
        title: 'Elevated webhook failures',
        detail: `${input.failedWebhooks} failed deliveries in range.`,
      });
    }
    if (input.lockedUsers > 0) {
      alerts.push({
        severity: 'info',
        code: 'LOCKED_USERS',
        title: 'Locked accounts',
        detail: `${input.lockedUsers} user(s) currently locked.`,
      });
    }
    if (input.paymentsFailed > 0) {
      alerts.push({
        severity: 'warning',
        code: 'PAYMENT_FAILURES',
        title: 'Failed / abandoned checkouts',
        detail: `${input.paymentsFailed} unsuccessful payment attempt(s).`,
      });
    }
    if (input.revenueGrowthPct <= -20) {
      alerts.push({
        severity: 'critical',
        code: 'REVENUE_DROP',
        title: 'Revenue down vs prior period',
        detail: `Revenue changed ${input.revenueGrowthPct}% versus the previous window.`,
      });
    }
    if (input.orgsSuspended > 0) {
      alerts.push({
        severity: 'info',
        code: 'SUSPENDED_ORGS',
        title: 'Suspended workspaces',
        detail: `${input.orgsSuspended} organization(s) suspended.`,
      });
    }
    return alerts;
  }

  private suggestedActions(
    alerts: Array<{ code: string }>,
  ): Array<{ code: string; label: string; href: string }> {
    const actions: Array<{ code: string; label: string; href: string }> = [];
    if (alerts.some((a) => a.code === 'KYC_BACKLOG')) {
      actions.push({
        code: 'REVIEW_KYC',
        label: 'Review pending organizations',
        href: '/admin/organizations?status=PENDING',
      });
    }
    if (alerts.some((a) => a.code === 'REPORT_BACKLOG')) {
      actions.push({
        code: 'TRIAGE_REPORTS',
        label: 'Triage consumer reports',
        href: '/admin/reports',
      });
    }
    if (alerts.some((a) => a.code === 'PAYMENT_FAILURES' || a.code === 'REVENUE_DROP')) {
      actions.push({
        code: 'REVIEW_SUBSCRIBERS',
        label: 'Inspect subscribers & payments',
        href: '/admin/subscribers',
      });
    }
    if (actions.length === 0) {
      actions.push({
        code: 'PLATFORM_HEALTH',
        label: 'Scan platform metrics',
        href: '/admin',
      });
    }
    return actions.slice(0, 5);
  }
}
