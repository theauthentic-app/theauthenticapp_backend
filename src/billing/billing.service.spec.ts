import { createHmac } from 'crypto';

jest.mock('../notifications/notifications.service', () => ({
  NotificationsService: class {},
}));
jest.mock('../audit/audit.service', () => ({ AuditService: class {} }));
jest.mock('../database/prisma.service', () => ({ PrismaService: class {} }));

import { AppError } from '../common/errors/app-error';
import { BillingService } from './billing.service';
import { PaystackService } from './paystack.service';
import { TERMS_VERSION } from './plans';

type Mocked = Record<string, jest.Mock>;

function setup(paymentOverrides: Record<string, unknown> = {}) {
  const payment = {
    id: 'pay-row',
    organizationId: 'org-1',
    planCode: 'GROWTH',
    amountKobo: 25_000_000,
    currency: 'NGN',
    reference: 'pay_ref',
    status: 'PENDING',
    ...paymentOverrides,
  };
  const prisma = {
    payment: {
      findUnique: jest.fn().mockResolvedValue(payment),
      updateMany: jest.fn().mockResolvedValue({ count: 1 }),
      create: jest.fn(),
    } as Mocked,
    subscription: {
      upsert: jest.fn().mockResolvedValue({}),
      update: jest.fn().mockResolvedValue({}),
    } as Mocked,
    $transaction: jest.fn(),
  };
  prisma.$transaction.mockImplementation((fn: (db: unknown) => unknown) =>
    fn(prisma),
  );
  const paystack = {
    enabled: jest.fn().mockReturnValue(true),
    mode: jest.fn().mockReturnValue('test'),
    publicKey: jest.fn().mockReturnValue(null),
    verify: jest.fn(),
    initialize: jest.fn(),
    verifySignature: jest.fn().mockReturnValue(true),
  };
  const audit = { record: jest.fn().mockResolvedValue(undefined) };
  const notifications = { notifyOrganizationSafe: jest.fn() };
  const service = new BillingService(
    prisma as never,
    paystack as never,
    audit as never,
    notifications as never,
  );
  return { service, prisma, paystack, audit, notifications };
}

const paid = (extra: Record<string, unknown> = {}) => ({
  status: 'success',
  reference: 'pay_ref',
  amount: 25_000_000,
  currency: 'NGN',
  paid_at: '2026-11-06T10:00:00.000Z',
  ...extra,
});

async function codeOf(promise: Promise<unknown>) {
  try {
    await promise;
  } catch (error) {
    return error instanceof AppError ? error.code : String(error);
  }
  return 'NO_ERROR';
}

describe('BillingService.verifyReference', () => {
  it('activates the plan once for a matching successful charge', async () => {
    const { service, paystack, prisma, notifications } = setup();
    paystack.verify.mockResolvedValue(paid());

    const result = await service.verifyReference('pay_ref');

    expect(result).toMatchObject({ status: 'SUCCESS', alreadyProcessed: false });
    expect(prisma.subscription.upsert).toHaveBeenCalledTimes(1);
    expect(notifications.notifyOrganizationSafe).toHaveBeenCalledTimes(1);
  });

  it('does not activate twice when the webhook and redirect race', async () => {
    const { service, paystack, prisma, notifications } = setup();
    paystack.verify.mockResolvedValue(paid());
    prisma.payment.updateMany.mockResolvedValue({ count: 0 });

    const result = await service.verifyReference('pay_ref');

    expect(result).toMatchObject({ status: 'SUCCESS', alreadyProcessed: true });
    expect(prisma.subscription.upsert).not.toHaveBeenCalled();
    expect(notifications.notifyOrganizationSafe).not.toHaveBeenCalled();
  });

  it('refuses to activate when the amount paid differs from the plan', async () => {
    const { service, paystack, prisma } = setup();
    paystack.verify.mockResolvedValue(paid({ amount: 100 }));

    expect(await codeOf(service.verifyReference('pay_ref'))).toBe('PAYMENT_MISMATCH');
    expect(prisma.payment.updateMany).toHaveBeenCalledWith(
      expect.objectContaining({ data: { status: 'AMOUNT_MISMATCH' } }),
    );
    expect(prisma.subscription.upsert).not.toHaveBeenCalled();
  });

  it('refuses to activate when the currency differs', async () => {
    const { service, paystack } = setup();
    paystack.verify.mockResolvedValue(paid({ currency: 'USD' }));

    expect(await codeOf(service.verifyReference('pay_ref'))).toBe('PAYMENT_MISMATCH');
  });

  it('reports PENDING without failing the payment while checkout is still open', async () => {
    const { service, paystack, prisma } = setup();
    paystack.verify.mockResolvedValue(paid({ status: 'abandoned' }));

    const result = await service.verifyReference('pay_ref');

    expect(result).toMatchObject({ status: 'PENDING' });
    expect(prisma.payment.updateMany).not.toHaveBeenCalled();
  });

  it('marks declined charges as FAILED', async () => {
    const { service, paystack, prisma } = setup();
    paystack.verify.mockResolvedValue(
      paid({ status: 'failed', gateway_response: 'Declined' }),
    );

    expect(await codeOf(service.verifyReference('pay_ref'))).toBe('PAYMENT_FAILED');
    expect(prisma.payment.updateMany).toHaveBeenCalledWith(
      expect.objectContaining({ data: { status: 'FAILED' } }),
    );
  });

  it('short-circuits payments that already succeeded', async () => {
    const { service, paystack } = setup({ status: 'SUCCESS' });

    const result = await service.verifyReference('pay_ref');

    expect(result).toMatchObject({ alreadyProcessed: true });
    expect(paystack.verify).not.toHaveBeenCalled();
  });
});

describe('BillingService.handlePaystackWebhook', () => {
  const body = (event: unknown) => Buffer.from(JSON.stringify(event));

  it('rejects an invalid signature', async () => {
    const { service, paystack } = setup();
    paystack.verifySignature.mockReturnValue(false);

    expect(
      await codeOf(service.handlePaystackWebhook(body({ event: 'charge.success' }), 'bad')),
    ).toBe('INVALID_SIGNATURE');
  });

  it('ignores events other than charge.success', async () => {
    const { service } = setup();

    const result = await service.handlePaystackWebhook(
      body({ event: 'transfer.success', data: {} }),
      'sig',
    );

    expect(result).toMatchObject({ ignored: true });
  });

  it('acknowledges references it does not own so Paystack stops retrying', async () => {
    const { service, prisma } = setup();
    prisma.payment.findUnique.mockResolvedValue(null);

    const result = await service.handlePaystackWebhook(
      body({ event: 'charge.success', data: { reference: 'someone_else' } }),
      'sig',
    );

    expect(result).toMatchObject({ ignored: true, reason: 'PAYMENT_NOT_FOUND' });
  });

  it('lets Paystack outages bubble up so the webhook is retried', async () => {
    const { service, paystack } = setup();
    paystack.verify.mockRejectedValue(
      new AppError('PAYSTACK_UNAVAILABLE', 'down', 502),
    );

    expect(
      await codeOf(
        service.handlePaystackWebhook(
          body({ event: 'charge.success', data: { reference: 'pay_ref' } }),
          'sig',
        ),
      ),
    ).toBe('PAYSTACK_UNAVAILABLE');
  });
});

describe('BillingService.subscribe callbackUrl', () => {
  const saved = { ...process.env };
  beforeEach(() => {
    process.env.APP_WEB_URL = 'https://authentic-web-platform.vercel.app';
    process.env.CORS_ORIGINS = 'http://localhost:3000';
  });
  afterEach(() => {
    process.env = { ...saved };
  });

  it('rejects return URLs on foreign origins', async () => {
    const { service, paystack } = setup();

    expect(
      await codeOf(
        service.subscribe('org-1', 'GROWTH', TERMS_VERSION, { email: 'a@b.co' }, 'https://evil.example/return'),
      ),
    ).toBe('INVALID_CALLBACK_URL');
    expect(paystack.initialize).not.toHaveBeenCalled();
  });

  it('accepts return URLs on the web app origin', async () => {
    const { service, paystack } = setup();
    paystack.initialize.mockResolvedValue({
      authorization_url: 'https://checkout.paystack.com/x',
      access_code: 'x',
      reference: 'r',
    });

    const result = await service.subscribe(
      'org-1',
      'GROWTH',
      TERMS_VERSION,
      { email: 'a@b.co' },
      'https://authentic-web-platform.vercel.app/billing/return',
    );

    expect(result).toMatchObject({ status: 'PAYMENT_PENDING' });
    expect(paystack.initialize).toHaveBeenCalledWith(
      expect.objectContaining({ amountKobo: 25_000_000, currency: 'NGN' }),
    );
  });
});

describe('PaystackService.verifySignature', () => {
  const saved = process.env.PAYSTACK_SECRET_KEY;
  afterEach(() => {
    process.env.PAYSTACK_SECRET_KEY = saved;
  });

  it('accepts the HMAC-SHA512 Paystack sends and rejects tampering', () => {
    process.env.PAYSTACK_SECRET_KEY = 'sk_test_abc123';
    const service = new PaystackService();
    const raw = Buffer.from('{"event":"charge.success"}');
    const signature = createHmac('sha512', 'sk_test_abc123').update(raw).digest('hex');

    expect(service.verifySignature(raw, signature)).toBe(true);
    expect(service.verifySignature(Buffer.from('{"event":"x"}'), signature)).toBe(false);
    expect(service.mode()).toBe('test');
  });
});
