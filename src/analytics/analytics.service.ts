import { Injectable } from '@nestjs/common';
import {
  OrganizationMemberRole,
  Prisma,
  VerificationStatus,
} from '@prisma/client';
import { BillingService } from '../billing/billing.service';
import { PrismaService } from '../database/prisma.service';
import { sectionsForRole } from './role-capabilities';

export type DashboardFilters = {
  days?: number;
  from?: string;
  to?: string;
  productId?: string;
  batchId?: string;
};

type AlertItem = {
  severity: 'info' | 'warning' | 'critical';
  code: string;
  title: string;
  detail: string;
};

@Injectable()
export class AnalyticsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly billing: BillingService,
  ) {}

  async dashboard(
    organizationId: string,
    filters: DashboardFilters = {},
    role?: OrganizationMemberRole | null,
  ) {
    const sections = sectionsForRole(role);
    const to = filters.to ? new Date(filters.to) : new Date();
    const from = filters.from
      ? new Date(filters.from)
      : new Date(to.getTime() - (filters.days ?? 30) * 86_400_000);
    const prevMs = to.getTime() - from.getTime();
    const prevFrom = new Date(from.getTime() - Math.max(prevMs, 86_400_000));
    const prevTo = from;

    const identityScope = await this.identityScope(
      organizationId,
      filters.productId,
      filters.batchId,
    );
    const verifyWhere: Prisma.VerificationWhereInput = {
      createdAt: { gte: from, lte: to },
      productIdentity: identityScope,
    };
    const prevVerifyWhere: Prisma.VerificationWhereInput = {
      createdAt: { gte: prevFrom, lte: prevTo },
      productIdentity: identityScope,
    };
    const todayStart = new Date();
    todayStart.setHours(0, 0, 0, 0);

    const [
      products,
      identities,
      active,
      reportsOpen,
      statusGroups,
      prevStatusGroups,
      cityGroups,
      countryGroups,
      scansToday,
      recent,
      topProducts,
      failedWebhooks,
      billing,
      trend,
      sourceGroups,
      activeRecalls,
      pendingIdentities,
      memberCount,
      membersByRole,
      openReportsList,
      batches,
      riskSignalsInRange,
      riskCritical,
      counterfeitReports,
      supplyEventsInRange,
      warrantiesActive,
      apiKeyCount,
      webhookCount,
    ] = await Promise.all([
      this.prisma.product.count({ where: { organizationId } }),
      this.prisma.productIdentity.count({ where: identityScope }),
      this.prisma.productIdentity.count({
        where: { ...identityScope, status: 'ACTIVE' },
      }),
      this.prisma.productReport.count({
        where: {
          productIdentity: identityScope,
          status: { in: ['OPEN', 'UNDER_REVIEW'] },
        },
      }),
      this.prisma.verification.groupBy({
        by: ['status'],
        where: verifyWhere,
        _count: { _all: true },
      }),
      this.prisma.verification.groupBy({
        by: ['status'],
        where: prevVerifyWhere,
        _count: { _all: true },
      }),
      this.prisma.verification.groupBy({
        by: ['city'],
        where: verifyWhere,
        _count: { _all: true },
        orderBy: { _count: { city: 'desc' } },
        take: 12,
      }),
      this.prisma.verification.groupBy({
        by: ['country'],
        where: verifyWhere,
        _count: { _all: true },
        orderBy: { _count: { country: 'desc' } },
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
      this.prisma.verification.groupBy({
        by: ['source'],
        where: verifyWhere,
        _count: { _all: true },
      }),
      this.prisma.recall.count({
        where: { organizationId, status: 'ACTIVE' },
      }),
      this.prisma.productIdentity.count({
        where: { ...identityScope, status: 'CREATED' },
      }),
      this.prisma.organizationMember.count({ where: { organizationId } }),
      this.prisma.organizationMember.groupBy({
        by: ['role'],
        where: { organizationId },
        _count: { _all: true },
      }),
      this.prisma.productReport.findMany({
        where: {
          productIdentity: identityScope,
          status: { in: ['OPEN', 'UNDER_REVIEW'] },
        },
        orderBy: { createdAt: 'desc' },
        take: 8,
        select: {
          publicId: true,
          reason: true,
          status: true,
          city: true,
          country: true,
          createdAt: true,
        },
      }),
      this.prisma.batch.count({ where: { organizationId } }),
      this.prisma.riskSignal.count({
        where: {
          detectedAt: { gte: from, lte: to },
          OR: [
            { productIdentity: { organizationId } },
            { verification: { productIdentity: { organizationId } } },
          ],
        },
      }),
      this.prisma.riskSignal.count({
        where: {
          severity: { in: ['HIGH', 'CRITICAL'] },
          detectedAt: { gte: from, lte: to },
          OR: [
            { productIdentity: { organizationId } },
            { verification: { productIdentity: { organizationId } } },
          ],
        },
      }),
      this.prisma.productReport.count({
        where: {
          reason: 'COUNTERFEIT',
          productIdentity: identityScope,
          createdAt: { gte: from, lte: to },
        },
      }),
      this.prisma.supplyChainEvent.count({
        where: {
          organizationId,
          occurredAt: { gte: from, lte: to },
        },
      }),
      this.prisma.warranty.count({
        where: {
          organizationId,
          status: { in: ['ACTIVE', 'PENDING'] },
        },
      }),
      this.prisma.apiKey.count({
        where: { organizationId, status: 'ACTIVE', revokedAt: null },
      }),
      this.prisma.webhookEndpoint.count({
        where: { organizationId, status: 'ACTIVE' },
      }),
    ]);

    const countOf = (
      groups: typeof statusGroups,
      status: VerificationStatus,
    ) => groups.find((row) => row.status === status)?._count._all ?? 0;

    const verified = countOf(statusGroups, VerificationStatus.AUTHENTICATED);
    const suspicious = countOf(statusGroups, VerificationStatus.SUSPICIOUS);
    const compromised = countOf(statusGroups, VerificationStatus.COMPROMISED);
    const recalled = countOf(statusGroups, VerificationStatus.RECALLED);
    const revoked = countOf(statusGroups, VerificationStatus.REVOKED);
    const alerts = compromised + recalled + revoked;
    const totalScans = statusGroups.reduce((n, row) => n + row._count._all, 0);
    const prevTotal = prevStatusGroups.reduce(
      (n, row) => n + row._count._all,
      0,
    );
    const scanGrowthPct =
      prevTotal === 0
        ? totalScans > 0
          ? 100
          : 0
        : Math.round(((totalScans - prevTotal) / prevTotal) * 1000) / 10;

    const authenticRate =
      totalScans === 0
        ? null
        : Math.round((verified / totalScans) * 1000) / 10;
    const riskRate =
      totalScans === 0
        ? null
        : Math.round(((suspicious + alerts) / totalScans) * 1000) / 10;

    const statusBreakdown = Object.fromEntries(
      statusGroups.map((row) => [row.status, row._count._all]),
    ) as Record<string, number>;

    const funnel = {
      identitiesIssued: identities,
      identitiesActive: active,
      scansInRange: totalScans,
      authenticated: verified,
      flagged: suspicious + alerts,
      conversionToScan:
        identities === 0
          ? null
          : Math.round((totalScans / identities) * 1000) / 10,
      authenticationRate: authenticRate,
    };

    const alertsList = this.buildOrgAlerts({
      riskRate,
      reportsOpen,
      activeRecalls,
      failedWebhooks,
      pendingIdentities,
      billingRemaining: billing.remaining,
      billingStatus: billing.status,
    });

    const protection = {
      kpis: {
        totalScans,
        scansToday,
        verified,
        suspicious,
        alerts,
        authenticRate,
        riskRate,
        scanGrowthPct,
      },
      statusBreakdown,
      trend,
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
      alerts: alertsList,
    };

    const payload: Record<string, unknown> = {
      meta: {
        audience: 'manufacturer',
        role: role ?? 'API_KEY',
        sections,
        range: { from, to },
        previousRange: { from: prevFrom, to: prevTo },
        generatedAt: new Date().toISOString(),
      },
      summary: {
        products,
        units: identities,
        active,
        reportsOpen,
        totalScans,
        scansToday,
        verified,
        suspicious,
        alerts,
        activeRecalls,
        plan: {
          code: billing.plan.code,
          name: billing.plan.name,
          status: billing.status,
        },
      },
      protection,
      modules: this.buildModules({
        products,
        batches,
        totalScans,
        verified,
        suspicious,
        alerts,
        riskSignalsInRange,
        riskCritical,
        counterfeitReports,
        compromised,
        supplyEventsInRange,
        activeRecalls,
        warrantiesActive,
        authenticRate,
        riskRate,
        apiKeyCount,
        webhookCount,
        planCode: billing.plan.code,
        apiKeysEnabled: Boolean(billing.plan.apiKeys),
        webhooksEnabled: Boolean(billing.plan.webhooks),
      }),
      suggestedActions: this.suggestedActions(role, alertsList, sections),
    };

    if (sections.insights) {
      payload.insights = {
        funnel,
        geo: {
          cities: Object.fromEntries(
            cityGroups.map((row) => [row.city ?? 'Unknown', row._count._all]),
          ),
          countries: Object.fromEntries(
            countryGroups.map((row) => [
              row.country ?? 'Unknown',
              row._count._all,
            ]),
          ),
        },
        topProducts,
        sources: Object.fromEntries(
          sourceGroups.map((row) => [row.source, row._count._all]),
        ),
      };
    }

    if (sections.operations) {
      payload.operations = {
        openReports: reportsOpen,
        openReportsPreview: openReportsList.map((r) => ({
          id: r.publicId,
          reason: r.reason,
          status: r.status,
          city: r.city,
          country: r.country,
          createdAt: r.createdAt,
        })),
        activeRecalls,
        pendingIdentities,
        failedWebhooks,
        quota: billing.remaining,
        usage: billing.usage,
      };
    }

    if (sections.finance) {
      payload.finance = {
        plan: {
          code: billing.plan.code,
          name: billing.plan.name,
          status: billing.status,
          trialEndsAt: billing.trialEndsAt,
          currentPeriodEnd: billing.currentPeriodEnd,
          termsCurrent: billing.termsCurrent,
        },
        payment: billing.payment,
        quota: billing.remaining,
        usage: billing.usage,
      };
    }

    if (sections.team) {
      payload.team = {
        memberCount,
        byRole: Object.fromEntries(
          membersByRole.map((row) => [row.role, row._count._all]),
        ),
      };
    }

    return payload;
  }

  private buildOrgAlerts(input: {
    riskRate: number | null;
    reportsOpen: number;
    activeRecalls: number;
    failedWebhooks: number;
    pendingIdentities: number;
    billingRemaining: {
      identities: number | null;
      verifications: number | null;
      brands: number | null;
    };
    billingStatus: string;
  }): AlertItem[] {
    const out: AlertItem[] = [];
    if (input.activeRecalls > 0) {
      out.push({
        severity: 'critical',
        code: 'ACTIVE_RECALLS',
        title: 'Active recalls',
        detail: `${input.activeRecalls} recall(s) are active — consumers will see recall status on scan.`,
      });
    }
    if (input.reportsOpen > 0) {
      out.push({
        severity: 'warning',
        code: 'OPEN_REPORTS',
        title: 'Open consumer reports',
        detail: `${input.reportsOpen} report(s) need review.`,
      });
    }
    if (input.riskRate != null && input.riskRate >= 15) {
      out.push({
        severity: 'warning',
        code: 'ELEVATED_RISK_RATE',
        title: 'Elevated risk scan rate',
        detail: `${input.riskRate}% of scans in range are suspicious or worse.`,
      });
    }
    if (input.failedWebhooks > 0) {
      out.push({
        severity: 'warning',
        code: 'WEBHOOK_FAILURES',
        title: 'Webhook delivery failures',
        detail: `${input.failedWebhooks} failed delivery(ies) in range.`,
      });
    }
    if (input.pendingIdentities > 100) {
      out.push({
        severity: 'info',
        code: 'PENDING_ACTIVATION',
        title: 'Identities awaiting activation',
        detail: `${input.pendingIdentities} identities are still in CREATED state.`,
      });
    }
    const vLeft = input.billingRemaining.verifications;
    if (vLeft != null && vLeft <= 0) {
      out.push({
        severity: 'critical',
        code: 'VERIFY_QUOTA_EXHAUSTED',
        title: 'Verification quota exhausted',
        detail: 'Upgrade or wait for the next billing period.',
      });
    } else if (vLeft != null && vLeft < 1000) {
      out.push({
        severity: 'warning',
        code: 'VERIFY_QUOTA_LOW',
        title: 'Verification quota running low',
        detail: `${vLeft} verifications remaining this period.`,
      });
    }
    if (
      input.billingStatus === 'TRIAL' ||
      input.billingStatus === 'PAST_DUE' ||
      input.billingStatus === 'EXPIRED'
    ) {
      out.push({
        severity:
          input.billingStatus === 'TRIAL' ? 'info' : 'critical',
        code: `BILLING_${input.billingStatus}`,
        title: `Subscription ${input.billingStatus.toLowerCase()}`,
        detail:
          input.billingStatus === 'TRIAL'
            ? 'Trial workspace — convert to a paid plan before trial ends.'
            : 'Billing needs attention to keep issuing and verifying.',
      });
    }
    return out;
  }

  private buildModules(input: {
    products: number;
    batches: number;
    totalScans: number;
    verified: number;
    suspicious: number;
    alerts: number;
    riskSignalsInRange: number;
    riskCritical: number;
    counterfeitReports: number;
    compromised: number;
    supplyEventsInRange: number;
    activeRecalls: number;
    warrantiesActive: number;
    authenticRate: number | null;
    riskRate: number | null;
    apiKeyCount: number;
    webhookCount: number;
    planCode: string;
    apiKeysEnabled: boolean;
    webhooksEnabled: boolean;
  }) {
    const tone = (
      severity: 'ok' | 'watch' | 'alert',
    ): 'ok' | 'watch' | 'alert' => severity;

    return [
      {
        key: 'products',
        title: 'Products',
        href: '/products',
        api: { list: 'GET /products', create: 'POST /products' },
        kpis: { count: input.products },
        status: tone(input.products > 0 ? 'ok' : 'watch'),
        blurb:
          input.products > 0
            ? `${input.products} catalog product(s) ready to serialize.`
            : 'Add brands and products before minting identities.',
      },
      {
        key: 'batches',
        title: 'Batches',
        href: '/batches',
        api: { list: 'GET /batches', create: 'POST /batches' },
        kpis: { count: input.batches },
        status: tone(input.batches > 0 ? 'ok' : 'watch'),
        blurb:
          input.batches > 0
            ? `${input.batches} production batch(es) on file.`
            : 'Create a batch to generate serials.',
      },
      {
        key: 'verifications',
        title: 'Verifications',
        href: '/verifications',
        api: {
          list: 'GET /analytics/verifications',
          publicVerify: 'POST /public/verify',
        },
        kpis: {
          total: input.totalScans,
          authenticated: input.verified,
          rate: input.authenticRate,
        },
        status: tone(
          input.riskRate != null && input.riskRate >= 15 ? 'alert' : 'ok',
        ),
        blurb: `${input.verified} authenticated of ${input.totalScans} scans in range.`,
      },
      {
        key: 'riskSignals',
        title: 'Risk Signals',
        href: '/risk-signals',
        api: { list: 'GET /risk-signals' },
        kpis: {
          total: input.riskSignalsInRange,
          critical: input.riskCritical,
        },
        status: tone(
          input.riskCritical > 0
            ? 'alert'
            : input.riskSignalsInRange > 0
              ? 'watch'
              : 'ok',
        ),
        blurb:
          input.riskSignalsInRange > 0
            ? `${input.riskSignalsInRange} signal(s); ${input.riskCritical} high/critical.`
            : 'No elevated risk signals in this window.',
      },
      {
        key: 'counterfeitIntel',
        title: 'Counterfeit Intel',
        href: '/intel/counterfeit',
        api: { summary: 'GET /intel/counterfeit' },
        kpis: {
          reports: input.counterfeitReports,
          compromisedScans: input.compromised,
          suspicious: input.suspicious,
        },
        status: tone(
          input.counterfeitReports + input.compromised > 0 ? 'alert' : 'ok',
        ),
        blurb:
          'Evidence from COUNTERFEIT reports and compromised scans — not a legal verdict.',
      },
      {
        key: 'supplyChain',
        title: 'Supply Chain',
        href: '/supply-chain',
        api: {
          list: 'GET /supply-chain/events',
          create: 'POST /supply-chain/events',
        },
        kpis: { events: input.supplyEventsInRange },
        status: tone('ok'),
        blurb: `${input.supplyEventsInRange} custody event(s) logged in range.`,
      },
      {
        key: 'recalls',
        title: 'Recall Center',
        href: '/recalls',
        api: { list: 'GET /recalls', create: 'POST /recalls' },
        kpis: { active: input.activeRecalls },
        status: tone(input.activeRecalls > 0 ? 'alert' : 'ok'),
        blurb:
          input.activeRecalls > 0
            ? `${input.activeRecalls} active recall campaign(s).`
            : 'No active recalls.',
      },
      {
        key: 'warranties',
        title: 'Warranties',
        href: '/warranties',
        api: { list: 'GET /warranties', register: 'POST /warranties' },
        kpis: { active: input.warrantiesActive },
        status: tone('ok'),
        blurb: `${input.warrantiesActive} active/pending warranty record(s).`,
      },
      {
        key: 'analytics',
        title: 'Analytics',
        href: '/analytics',
        api: { dashboard: 'GET /analytics/dashboard' },
        kpis: {
          scans: input.totalScans,
          alerts: input.alerts,
          authenticRate: input.authenticRate,
        },
        status: tone('ok'),
        blurb: 'Role-aware KPIs, trends, and geo — this home screen.',
      },
      {
        key: 'apiAccess',
        title: 'API Access',
        href: '/developers',
        api: {
          keys: 'GET /api-keys',
          webhooks: 'GET /webhooks',
        },
        kpis: {
          keys: input.apiKeyCount,
          webhooks: input.webhookCount,
          plan: input.planCode,
        },
        status: tone(
          input.apiKeysEnabled || input.webhooksEnabled ? 'ok' : 'watch',
        ),
        blurb: input.apiKeysEnabled
          ? `${input.apiKeyCount} live key(s), ${input.webhookCount} webhook(s).`
          : 'Upgrade plan to enable partner API keys and webhooks.',
        locked: !input.apiKeysEnabled,
      },
    ];
  }

  private suggestedActions(
    role: OrganizationMemberRole | null | undefined,
    alerts: AlertItem[],
    sections: ReturnType<typeof sectionsForRole>,
  ): Array<{ code: string; label: string; href: string }> {
    const actions: Array<{ code: string; label: string; href: string }> = [];
    for (const alert of alerts) {
      if (alert.code === 'OPEN_REPORTS' && sections.operations) {
        actions.push({
          code: 'REVIEW_REPORTS',
          label: 'Review open reports',
          href: '/reports',
        });
      }
      if (alert.code === 'ACTIVE_RECALLS' && sections.operations) {
        actions.push({
          code: 'MANAGE_RECALLS',
          label: 'Manage recalls',
          href: '/recalls',
        });
      }
      if (alert.code.startsWith('BILLING_') && sections.finance) {
        actions.push({
          code: 'OPEN_BILLING',
          label: 'Open billing',
          href: '/billing',
        });
      }
      if (alert.code === 'WEBHOOK_FAILURES' && sections.finance) {
        actions.push({
          code: 'WEBHOOK_DELIVERIES',
          label: 'Retry webhooks',
          href: '/webhooks',
        });
      }
    }
    if (
      (role === 'OWNER' || role === 'ADMIN' || role === 'MANAGER') &&
      actions.length === 0
    ) {
      actions.push({
        code: 'GENERATE_IDENTITIES',
        label: 'Generate product identities',
        href: '/identities',
      });
    }
    return actions.slice(0, 5);
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
