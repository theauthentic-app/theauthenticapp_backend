import { Injectable, Logger } from '@nestjs/common';
import { createHmac, timingSafeEqual } from 'crypto';
import { AppError } from '../common/errors/app-error';
import { env } from '../common/utils/env.util';

const PAYSTACK_API = 'https://api.paystack.co';
const REQUEST_TIMEOUT_MS = 15_000;

type PaystackEnvelope<T> = {
  status: boolean;
  message: string;
  data?: T;
};

type PaystackInitializeData = {
  authorization_url: string;
  access_code: string;
  reference: string;
};

/** `status` is one of: success, failed, abandoned, ongoing, pending, processing, queued, reversed. */
export type PaystackTransaction = {
  status: string;
  reference: string;
  amount: number;
  currency: string;
  paid_at?: string | null;
  channel?: string;
  gateway_response?: string;
  customer?: { email?: string };
  metadata?: Record<string, unknown> | string | null;
};

export type PaystackMode = 'test' | 'live';

@Injectable()
export class PaystackService {
  private readonly logger = new Logger(PaystackService.name);

  enabled(): boolean {
    return Boolean(env('PAYSTACK_SECRET_KEY'));
  }

  publicKey(): string | null {
    return env('PAYSTACK_PUBLIC_KEY') ?? null;
  }

  mode(): PaystackMode | null {
    const secret = env('PAYSTACK_SECRET_KEY');
    if (!secret) return null;
    return secret.startsWith('sk_live_') ? 'live' : 'test';
  }

  async initialize(input: {
    email: string;
    amountKobo: number;
    currency: string;
    reference: string;
    callbackUrl: string;
    metadata: Record<string, string>;
  }): Promise<PaystackInitializeData> {
    const body = await this.request<PaystackInitializeData>(
      '/transaction/initialize',
      {
        method: 'POST',
        body: JSON.stringify({
          email: input.email,
          amount: input.amountKobo,
          currency: input.currency,
          reference: input.reference,
          callback_url: input.callbackUrl,
          metadata: input.metadata,
        }),
      },
    );
    if (!body.status || !body.data) {
      this.logger.warn(`Paystack initialize failed: ${body.message}`);
      throw new AppError(
        'PAYSTACK_ERROR',
        body.message || 'Paystack could not start this payment.',
        502,
      );
    }
    return body.data;
  }

  async verify(reference: string): Promise<PaystackTransaction> {
    const body = await this.request<PaystackTransaction>(
      `/transaction/verify/${encodeURIComponent(reference)}`,
      { method: 'GET' },
    );
    if (!body.status || !body.data) {
      throw new AppError(
        'PAYSTACK_ERROR',
        body.message || 'Paystack could not verify this payment.',
        502,
      );
    }
    return body.data;
  }

  verifySignature(rawBody: Buffer, signature?: string): boolean {
    const secret = env('PAYSTACK_SECRET_KEY');
    if (!secret || !signature) return false;
    const digest = createHmac('sha512', secret).update(rawBody).digest('hex');
    const left = Buffer.from(digest);
    const right = Buffer.from(signature);
    return left.length === right.length && timingSafeEqual(left, right);
  }

  private async request<T>(
    path: string,
    init: { method: 'GET' | 'POST'; body?: string },
  ): Promise<PaystackEnvelope<T>> {
    const secret = this.requireSecret();
    let response: Response;
    try {
      response = await fetch(`${PAYSTACK_API}${path}`, {
        method: init.method,
        body: init.body,
        headers: {
          Authorization: `Bearer ${secret}`,
          'Content-Type': 'application/json',
        },
        signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
      });
    } catch (error) {
      this.logger.warn(`Paystack ${path} unreachable: ${String(error)}`);
      throw new AppError(
        'PAYSTACK_UNAVAILABLE',
        'Paystack is not responding. Try again in a moment.',
        502,
      );
    }
    try {
      return (await response.json()) as PaystackEnvelope<T>;
    } catch {
      throw new AppError(
        'PAYSTACK_ERROR',
        `Paystack returned an unreadable response (HTTP ${response.status}).`,
        502,
      );
    }
  }

  private requireSecret(): string {
    const secret = env('PAYSTACK_SECRET_KEY');
    if (!secret) {
      throw new AppError(
        'PAYSTACK_NOT_CONFIGURED',
        'PAYSTACK_SECRET_KEY is not set.',
        503,
      );
    }
    return secret;
  }
}
