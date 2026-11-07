import { Injectable, Logger } from '@nestjs/common';
import type { Prisma } from '@prisma/client';
import { AppError } from '../common/errors/app-error';
import { env } from '../common/utils/env.util';
import { publicId } from '../common/utils/crypto.util';
import { PrismaService } from '../database/prisma.service';
import { AuditService } from '../audit/audit.service';
import {
  LEGAL_TERMS,
  PLANS,
  PRIVACY_NOTICE,
  PlanCode,
  TERMS_VERSION,
  publicPricingCatalog,
  trialCreateInput,
} from './plans';
import { NotificationsService } from '../notifications/notifications.service';
import { PaystackService } from './paystack.service';
import {
  paginatedResult,
  paginationOf,
  type PaginationInput,
} from '../common/utils/pagination.util';

const PERIOD_MS = 30 * 86_400_000;
const STALE_PENDING_MS = 24 * 3_600_000;
const PAYSTACK_STILL_OPEN = new Set([
  'abandoned',
  'ongoing',
  'pending',
  'processing',
  'queued',
]);
/** Webhook outcomes Paystack retrying would not change. */
const WEBHOOK_FINAL_CODES = new Set([
  'PAYMENT_NOT_FOUND',
  'PAYMENT_FAILED',
  'PAYMENT_MISMATCH',
]);

type DbClient = Prisma.TransactionClient;

@Injectable()
export class BillingService {
  private readonly logger = new Logger(BillingService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly paystack: PaystackService,
    private readonly audit: AuditService,
    private readonly notifications: NotificationsService,
  ) {}

  catalog() {
    return {
      ...publicPricingCatalog(),
      payment: this.paymentMode(),
    };
  }

  terms() {
    return LEGAL_TERMS;
  }

  privacy() {
    return PRIVACY_NOTICE;
  }

  paymentMode() {
    return {
      provider: this.paystack.enabled() ? 'paystack' : 'invoice',
      enabled: this.paystack.enabled(),
      mode: this.paystack.mode(),
      publicKey: this.paystack.publicKey(),
    };
  }

  async ensureSubscription(organizationId: string) {
    const existing = await this.prisma.subscription.findUnique({
      where: { organizationId },
    });
    if (existing) return existing;
    return this.prisma.subscription.create({
      data: { organizationId, ...trialCreateInput() },
    });
  }

  async snapshot(organizationId: string) {
    const sub = await this.ensureSubscription(organizationId);
    const plan = this.planOf(sub.planCode);
    const usage = await this.usage(organizationId, sub.currentPeriodStart);
    const latestPayment = await this.prisma.payment.findFirst({
      where: { organizationId },
      orderBy: { createdAt: 'desc' },
    });
    return {
      plan,
      status: this.effectiveStatus(sub),
      trialEndsAt: sub.trialEndsAt,
      currentPeriodStart: sub.currentPeriodStart,
      currentPeriodEnd: sub.currentPeriodEnd,
      acceptedTermsVersion: sub.acceptedTermsVersion,
      termsCurrent: sub.acceptedTermsVersion === TERMS_VERSION,
      payment: {
        ...this.paymentMode(),
        lastReference: sub.lastPaymentReference,
        latest: latestPayment
          ? {
              reference: latestPayment.reference,
              status: latestPayment.status,
              planCode: latestPayment.planCode,
              authorizationUrl: latestPayment.authorizationUrl,
            }
          : null,
      },
      usage,
      remaining: {
        identities:
          plan.identityQuota == null
            ? null
            : Math.max(0, plan.identityQuota - usage.identities),
        verifications:
          plan.verificationQuota == null
            ? null
            : Math.max(0, plan.verificationQuota - usage.verifications),
        brands:
          plan.brandQuota == null
            ? null
            : Math.max(0, plan.brandQuota - usage.brands),
      },
    };
  }

  async subscribe(
    organizationId: string,
    planCode: PlanCode,
    acceptedTermsVersion: string,
    actor: { email: string; userId?: string },
    callbackUrl?: string,
  ) {
    if (acceptedTermsVersion !== TERMS_VERSION) {
      throw new AppError(
        'TERMS_OUTDATED',
        'Accept the current AUTHENTIC terms to subscribe.',
        400,
      );
    }
    const plan = PLANS[planCode];
    if (!plan) {
      throw new AppError('UNKNOWN_PLAN', 'That plan is not available.', 400);
    }

    if (planCode === 'ENTERPRISE' || plan.monthlyNgn == null) {
      return this.markInvoice(organizationId, planCode, acceptedTermsVersion);
    }

    if (!this.paystack.enabled()) {
      return this.markInvoice(organizationId, planCode, acceptedTermsVersion);
    }

    if (callbackUrl) this.assertCallbackUrl(callbackUrl);

    const reference = publicId('pay', 18);
    const amountKobo = plan.monthlyNgn * 100;
    const currency = 'NGN';
    const web = env('APP_WEB_URL', 'http://localhost:3001');
    const checkout = await this.paystack.initialize({
      email: actor.email,
      amountKobo,
      currency,
      reference,
      callbackUrl:
        callbackUrl ?? `${web}/app?payment=return&reference=${reference}`,
      metadata: {
        organizationId,
        planCode,
        termsVersion: acceptedTermsVersion,
      },
    });

    await this.prisma.payment.create({
      data: {
        organizationId,
        planCode,
        amountKobo,
        currency,
        reference,
        status: 'PENDING',
        provider: 'paystack',
        authorizationUrl: checkout.authorization_url,
      },
    });
    await this.prisma.subscription.update({
      where: { organizationId },
      data: {
        acceptedTermsVersion,
        acceptedTermsAt: new Date(),
        lastPaymentReference: reference,
        paymentProvider: 'paystack',
      },
    });

    return {
      planCode,
      status: 'PAYMENT_PENDING',
      payment: {
        provider: 'paystack',
        reference,
        authorizationUrl: checkout.authorization_url,
        accessCode: checkout.access_code,
        amountKobo,
        message: 'Complete Paystack checkout to activate this plan.',
      },
    };
  }

  async verifyReference(reference: string) {
    const payment = await this.prisma.payment.findUnique({
      where: { reference },
    });
    if (!payment) {
      throw new AppError('PAYMENT_NOT_FOUND', 'Payment not found.', 404);
    }
    if (payment.status === 'SUCCESS') {
      return { reference, status: 'SUCCESS', alreadyProcessed: true };
    }
    const tx = await this.paystack.verify(reference);
    const txStatus = tx.status.toLowerCase();

    if (PAYSTACK_STILL_OPEN.has(txStatus)) {
      return {
        reference,
        status: 'PENDING',
        alreadyProcessed: false,
        message:
          'Paystack has not confirmed this payment yet. If you were charged, it will activate automatically.',
      };
    }

    if (txStatus !== 'success') {
      await this.prisma.payment.updateMany({
        where: { id: payment.id, status: { not: 'SUCCESS' } },
        data: { status: 'FAILED' },
      });
      throw new AppError(
        'PAYMENT_FAILED',
        tx.gateway_response || 'Paystack did not approve this payment.',
        402,
      );
    }

    if (
      tx.amount !== payment.amountKobo ||
      tx.currency?.toUpperCase() !== payment.currency.toUpperCase()
    ) {
      await this.prisma.payment.updateMany({
        where: { id: payment.id, status: { not: 'SUCCESS' } },
        data: { status: 'AMOUNT_MISMATCH' },
      });
      this.logger.error(
        `Paystack ${reference}: paid ${tx.amount} ${tx.currency}, expected ${payment.amountKobo} ${payment.currency}. Plan not activated.`,
      );
      throw new AppError(
        'PAYMENT_MISMATCH',
        'The amount paid does not match this plan. Contact support with your payment reference.',
        402,
      );
    }

    const planCode = payment.planCode as PlanCode;
    const paidAt = tx.paid_at ? new Date(tx.paid_at) : new Date();
    const activated = await this.prisma.$transaction(async (db) => {
      const claimed = await db.payment.updateMany({
        where: { id: payment.id, status: { not: 'SUCCESS' } },
        data: { status: 'SUCCESS', paidAt },
      });
      if (claimed.count === 0) return false;
      await this.writeActivePlan(
        db,
        payment.organizationId,
        planCode,
        reference,
        'paystack',
      );
      return true;
    });
    if (!activated) {
      return { reference, status: 'SUCCESS', alreadyProcessed: true };
    }
    await this.afterActivation(
      payment.organizationId,
      planCode,
      reference,
      'paystack',
    );
    return { reference, status: 'SUCCESS', alreadyProcessed: false };
  }

  async handlePaystackWebhook(rawBody: Buffer, signature?: string) {
    if (!this.paystack.verifySignature(rawBody, signature)) {
      throw new AppError('INVALID_SIGNATURE', 'Invalid Paystack signature.', 401);
    }
    let event: { event?: string; data?: { reference?: string } };
    try {
      event = JSON.parse(rawBody.toString('utf8')) as typeof event;
    } catch {
      throw new AppError('INVALID_PAYLOAD', 'Webhook body is not JSON.', 400);
    }
    if (event.event !== 'charge.success' || !event.data?.reference) {
      return { ignored: true, event: event.event ?? null };
    }
    try {
      return await this.verifyReference(event.data.reference);
    } catch (error) {
      if (error instanceof AppError && WEBHOOK_FINAL_CODES.has(error.code)) {
        this.logger.warn(
          `Paystack webhook ${event.data.reference}: ${error.code}`,
        );
        return { ignored: true, event: event.event, reason: error.code };
      }
      throw error;
    }
  }

  async listPayments(organizationId: string, query?: PaginationInput) {
    const { page, limit, skip, take } = paginationOf(query);
    const where = { organizationId };
    const [rows, total] = await this.prisma.$transaction([
      this.prisma.payment.findMany({
        where,
        orderBy: { createdAt: 'desc' },
        skip,
        take,
      }),
      this.prisma.payment.count({ where }),
    ]);
    return paginatedResult(
      rows.map((row) => ({
        reference: row.reference,
        planCode: row.planCode,
        planName: this.planOf(row.planCode).name,
        amountKobo: row.amountKobo,
        currency: row.currency,
        status: row.status,
        provider: row.provider,
        paidAt: row.paidAt,
        createdAt: row.createdAt,
      })),
      total,
      page,
      limit,
    );
  }

  async activatePaidPlan(
    organizationId: string,
    planCode: PlanCode,
    reference: string | null,
    provider: 'paystack' | 'invoice',
    actorUserId?: string,
  ) {
    await this.writeActivePlan(
      this.prisma,
      organizationId,
      planCode,
      reference,
      provider,
    );
    await this.afterActivation(
      organizationId,
      planCode,
      reference,
      provider,
      actorUserId,
    );
    return { organizationId, planCode, status: 'ACTIVE', provider };
  }

  private async writeActivePlan(
    db: DbClient,
    organizationId: string,
    planCode: PlanCode,
    reference: string | null,
    provider: 'paystack' | 'invoice',
  ) {
    const now = new Date();
    const periodEnd = new Date(now.getTime() + PERIOD_MS);
    await db.subscription.upsert({
      where: { organizationId },
      update: {
        planCode,
        status: 'ACTIVE',
        currentPeriodStart: now,
        currentPeriodEnd: periodEnd,
        trialEndsAt: null,
        lastPaymentReference: reference ?? undefined,
        paymentProvider: provider,
      },
      create: {
        organizationId,
        planCode,
        status: 'ACTIVE',
        currentPeriodStart: now,
        currentPeriodEnd: periodEnd,
        lastPaymentReference: reference,
        paymentProvider: provider,
      },
    });
  }

  private async afterActivation(
    organizationId: string,
    planCode: PlanCode,
    reference: string | null,
    provider: 'paystack' | 'invoice',
    actorUserId?: string,
  ) {
    await this.audit.record({
      action: 'SUBSCRIPTION_UPDATED',
      actorUserId,
      organizationId,
      entity: 'Subscription',
      metadata: { planCode, provider, reference },
    });
    const plan = this.planOf(planCode);
    this.notifications.notifyOrganizationSafe(organizationId, {
      subject: `Payment received — ${plan.name}`,
      template: 'payment-received',
      context: { planName: plan.name, reference: reference ?? 'invoice' },
    });
  }

  async renew(
    organizationId: string,
    acceptedTermsVersion: string,
    actor: { email: string; userId?: string },
    callbackUrl?: string,
  ) {
    const sub = await this.ensureSubscription(organizationId);
    return this.subscribe(
      organizationId,
      this.planOf(sub.planCode).code,
      acceptedTermsVersion,
      actor,
      callbackUrl,
    );
  }

  async reconcileSubscriptions() {
    const now = new Date();
    const soon = new Date(now.getTime() + 3 * 86_400_000);
    // A late charge.success webhook can still activate an ABANDONED payment.
    const abandoned = await this.prisma.payment.updateMany({
      where: {
        status: 'PENDING',
        createdAt: { lt: new Date(now.getTime() - STALE_PENDING_MS) },
      },
      data: { status: 'ABANDONED' },
    });
    const expired = await this.prisma.subscription.findMany({
      where: {
        status: { in: ['ACTIVE', 'TRIALING'] },
        OR: [
          { currentPeriodEnd: { lt: now } },
          { status: 'TRIALING', trialEndsAt: { lt: now } },
        ],
      },
    });
    for (const sub of expired) {
      await this.prisma.subscription.update({
        where: { id: sub.id },
        data: { status: 'PAST_DUE' },
      });
      this.notifications.notifyOrganizationSafe(sub.organizationId, {
        subject: 'AUTHENTIC plan past due',
        template: 'period-expired',
        context: { planName: this.planOf(sub.planCode).name },
        onceKey: `mail:expired:${sub.id}:${sub.currentPeriodEnd.toISOString().slice(0, 10)}`,
        onceTtlSeconds: 14 * 86_400,
      });
    }

    const trialEnding = await this.prisma.subscription.findMany({
      where: {
        status: 'TRIALING',
        trialEndsAt: { gte: now, lte: soon },
      },
    });
    for (const sub of trialEnding) {
      this.notifications.notifyOrganizationSafe(sub.organizationId, {
        subject: 'Your AUTHENTIC trial is ending',
        template: 'trial-ending',
        context: {
          planName: this.planOf(sub.planCode).name,
          endsAt: sub.trialEndsAt?.toDateString(),
        },
        onceKey: `mail:trial:${sub.id}:${sub.trialEndsAt?.toISOString().slice(0, 10)}`,
        onceTtlSeconds: 7 * 86_400,
      });
    }

    const periodEnding = await this.prisma.subscription.findMany({
      where: {
        status: 'ACTIVE',
        currentPeriodEnd: { gte: now, lte: soon },
      },
    });
    for (const sub of periodEnding) {
      this.notifications.notifyOrganizationSafe(sub.organizationId, {
        subject: `Renew ${this.planOf(sub.planCode).name} soon`,
        template: 'period-ending',
        context: {
          planName: this.planOf(sub.planCode).name,
          endsAt: sub.currentPeriodEnd.toDateString(),
        },
        onceKey: `mail:renew:${sub.id}:${sub.currentPeriodEnd.toISOString().slice(0, 10)}`,
        onceTtlSeconds: 7 * 86_400,
      });
    }

    return {
      expired: expired.length,
      trialEnding: trialEnding.length,
      periodEnding: periodEnding.length,
      abandonedPayments: abandoned.count,
    };
  }

  async listSubscribers(
    query?: PaginationInput & { status?: string; plan?: string },
  ) {
    const { page, limit, skip, take } = paginationOf(query);
    const where = {
      ...(query?.status ? { status: query.status } : {}),
      ...(query?.plan ? { planCode: query.plan } : {}),
    };
    const [rows, total] = await this.prisma.$transaction([
      this.prisma.subscription.findMany({
        where,
        include: {
          organization: {
            include: {
              members: {
                where: { role: 'OWNER' },
                include: {
                  user: { select: { email: true, firstName: true, lastName: true } },
                },
                take: 1,
              },
              payments: { orderBy: { createdAt: 'desc' }, take: 1 },
            },
          },
        },
        orderBy: { updatedAt: 'desc' },
        skip,
        take,
      }),
      this.prisma.subscription.count({ where }),
    ]);
    return paginatedResult(
      rows.map((row) => {
        const owner = row.organization.members[0]?.user;
        const payment = row.organization.payments[0];
        return {
          organizationId: row.organization.publicId,
          organizationName: row.organization.name,
          organizationStatus: row.organization.status,
          plan: row.planCode,
          status: this.effectiveStatus(row),
          trialEndsAt: row.trialEndsAt,
          currentPeriodEnd: row.currentPeriodEnd,
          paymentProvider: row.paymentProvider,
          lastPaymentReference: row.lastPaymentReference,
          owner: owner
            ? {
                email: owner.email,
                name: `${owner.firstName} ${owner.lastName}`.trim(),
              }
            : null,
          latestPayment: payment
            ? {
                reference: payment.reference,
                status: payment.status,
                amountKobo: payment.amountKobo,
                paidAt: payment.paidAt,
              }
            : null,
        };
      }),
      total,
      page,
      limit,
    );
  }

  async adminActivate(
    organizationPublicId: string,
    planCode: PlanCode,
    actorUserId: string,
  ) {
    const org = await this.prisma.organization.findUnique({
      where: { publicId: organizationPublicId },
    });
    if (!org) {
      throw new AppError('ORGANIZATION_NOT_FOUND', 'Organization not found.', 404);
    }
    const reference = publicId('inv', 16);
    await this.prisma.payment.create({
      data: {
        organizationId: org.id,
        planCode,
        amountKobo: (PLANS[planCode].monthlyNgn ?? 0) * 100,
        reference,
        status: 'SUCCESS',
        provider: 'invoice',
        paidAt: new Date(),
      },
    });
    return this.activatePaidPlan(
      org.id,
      planCode,
      reference,
      'invoice',
      actorUserId,
    );
  }

  async assertIdentityQuota(organizationId: string, additional: number) {
    const snap = await this.snapshot(organizationId);
    this.assertActive(snap.status);
    if (snap.plan.identityQuota == null) return;
    if (snap.usage.identities + additional > snap.plan.identityQuota) {
      throw new AppError(
        'PLAN_LIMIT',
        `This ${snap.plan.name} plan allows ${snap.plan.identityQuota.toLocaleString()} identities in the current period.`,
        403,
      );
    }
  }

  async assertBrandQuota(organizationId: string) {
    const snap = await this.snapshot(organizationId);
    this.assertActive(snap.status);
    if (snap.plan.brandQuota == null) return;
    if (snap.usage.brands >= snap.plan.brandQuota) {
      throw new AppError(
        'PLAN_LIMIT',
        `This ${snap.plan.name} plan allows ${snap.plan.brandQuota} brand${snap.plan.brandQuota === 1 ? '' : 's'}.`,
        403,
      );
    }
  }

  async assertFeature(
    organizationId: string,
    feature: 'apiKeys' | 'webhooks',
  ) {
    const snap = await this.snapshot(organizationId);
    this.assertActive(snap.status);
    if (!snap.plan[feature]) {
      throw new AppError(
        'PLAN_LIMIT',
        `Upgrade to Growth or Enterprise to use ${feature === 'apiKeys' ? 'API keys' : 'webhooks'}.`,
        403,
      );
    }
  }

  private async markInvoice(
    organizationId: string,
    planCode: PlanCode,
    acceptedTermsVersion: string,
  ) {
    const now = new Date();
    await this.prisma.subscription.upsert({
      where: { organizationId },
      update: {
        planCode,
        status: 'INVOICE_PENDING',
        acceptedTermsVersion,
        acceptedTermsAt: now,
        paymentProvider: 'invoice',
      },
      create: {
        organizationId,
        planCode,
        status: 'INVOICE_PENDING',
        acceptedTermsVersion,
        acceptedTermsAt: now,
        paymentProvider: 'invoice',
        currentPeriodStart: now,
        currentPeriodEnd: new Date(now.getTime() + 30 * 86_400_000),
      },
    });
    return {
      planCode,
      status: 'INVOICE_PENDING',
      payment: {
        provider: 'invoice',
        message:
          planCode === 'ENTERPRISE'
            ? 'An AUTHENTIC representative will confirm volume and issue an invoice.'
            : 'Paystack keys are not set. An admin will activate this plan after invoice payment. Add PAYSTACK_SECRET_KEY to enable checkout automatically.',
      },
    };
  }

  private assertCallbackUrl(callbackUrl: string) {
    const allowed = this.allowedCallbackOrigins();
    let origin: string;
    try {
      origin = new URL(callbackUrl).origin;
    } catch {
      throw new AppError('INVALID_CALLBACK_URL', 'callbackUrl is not a valid URL.', 400);
    }
    if (!allowed.has(origin)) {
      throw new AppError(
        'INVALID_CALLBACK_URL',
        `callbackUrl must be on an AUTHENTIC origin (${[...allowed].join(', ')}). Add yours to BILLING_CALLBACK_ORIGINS.`,
        400,
      );
    }
  }

  private allowedCallbackOrigins(): Set<string> {
    const candidates = [
      env('APP_WEB_URL'),
      env('API_BASE_URL'),
      ...(env('CORS_ORIGINS') ?? '').split(','),
      ...(env('BILLING_CALLBACK_ORIGINS') ?? '').split(','),
    ];
    const origins = new Set<string>();
    for (const candidate of candidates) {
      const value = candidate?.trim();
      if (!value) continue;
      try {
        origins.add(new URL(value).origin);
      } catch {
        // ignore malformed entries
      }
    }
    return origins;
  }

  private assertActive(status: string) {
    if (status === 'CANCELED' || status === 'PAST_DUE') {
      throw new AppError(
        'SUBSCRIPTION_INACTIVE',
        'This organization does not have an active AUTHENTIC plan.',
        403,
      );
    }
  }

  private async usage(organizationId: string, periodStart: Date) {
    const [identities, verifications, brands] = await Promise.all([
      this.prisma.productIdentity.count({
        where: { organizationId, createdAt: { gte: periodStart } },
      }),
      this.prisma.verification.count({
        where: {
          productIdentity: { organizationId },
          createdAt: { gte: periodStart },
        },
      }),
      this.prisma.brand.count({ where: { organizationId } }),
    ]);
    return { identities, verifications, brands };
  }

  private planOf(code: string) {
    return PLANS[(code as PlanCode) in PLANS ? (code as PlanCode) : 'STARTER'];
  }

  private effectiveStatus(sub: {
    status: string;
    trialEndsAt: Date | null;
  }) {
    if (
      sub.status === 'TRIALING' &&
      sub.trialEndsAt &&
      sub.trialEndsAt < new Date()
    ) {
      return 'PAST_DUE';
    }
    return sub.status;
  }
}
