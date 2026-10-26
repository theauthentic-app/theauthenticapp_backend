import { Injectable, Logger } from '@nestjs/common';
import { createHmac, timingSafeEqual } from 'crypto';
import { AppError } from '../common/errors/app-error';
import { env } from '../common/utils/env.util';

type PaystackInitializeResponse = {
  status: boolean;
  message: string;
  data?: {
    authorization_url: string;
    access_code: string;
    reference: string;
  };
};

type PaystackVerifyResponse = {
  status: boolean;
  message: string;
  data?: {
    status: string;
    reference: string;
    amount: number;
    currency: string;
    customer?: { email?: string };
    metadata?: Record<string, unknown>;
  };
};

@Injectable()
export class PaystackService {
  private readonly logger = new Logger(PaystackService.name);

  enabled(): boolean {
    return Boolean(env('PAYSTACK_SECRET_KEY'));
  }

  publicKey(): string | null {
    return env('PAYSTACK_PUBLIC_KEY') ?? null;
  }

  async initialize(input: {
    email: string;
    amountKobo: number;
    reference: string;
    callbackUrl: string;
    metadata: Record<string, string>;
  }) {
    const secret = this.requireSecret();
    const response = await fetch(
      'https://api.paystack.co/transaction/initialize',
      {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${secret}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          email: input.email,
          amount: input.amountKobo,
          currency: 'NGN',
          reference: input.reference,
          callback_url: input.callbackUrl,
          metadata: input.metadata,
        }),
      },
    );
    const body = (await response.json()) as PaystackInitializeResponse;
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

  async verify(reference: string) {
    const secret = this.requireSecret();
    const response = await fetch(
      `https://api.paystack.co/transaction/verify/${encodeURIComponent(reference)}`,
      { headers: { Authorization: `Bearer ${secret}` } },
    );
    const body = (await response.json()) as PaystackVerifyResponse;
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
