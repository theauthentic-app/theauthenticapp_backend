import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { BlockchainService } from '../blockchain/blockchain.service';
import { PrismaService } from '../database/prisma.service';
import { RedisService } from '../redis/redis.service';

@Injectable()
export class HealthService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly redis: RedisService,
    private readonly config: ConfigService,
    private readonly blockchain: BlockchainService,
  ) {}

  async check() {
    const [database, cache] = await Promise.all([
      this.prisma.$queryRaw`SELECT 1`.then(() => 'up').catch(() => 'down'),
      this.redis.ping().then((ok) => (ok ? 'up' : 'down')),
    ]);
    const status = database === 'up' ? 'ok' : 'degraded';
    const hasResend = Boolean(this.config.get('RESEND_API_KEY'));
    const hasSmtp = Boolean(this.config.get('SMTP_HOST'));
    const explicit = (
      this.config.get<string>('EMAIL_PROVIDER') ?? ''
    ).toLowerCase();
    const emailProvider =
      explicit === 'log'
        ? 'log'
        : explicit === 'smtp' || explicit === 'nodemailer'
          ? hasSmtp
            ? 'smtp'
            : 'log'
          : hasResend
            ? 'resend'
            : hasSmtp
              ? 'smtp'
              : 'log';
    const storageProvider =
      this.config.get<string>('STORAGE_PROVIDER')?.toLowerCase() ||
      (this.config.get('R2_ACCOUNT_ID') &&
      this.config.get('R2_ACCESS_KEY_ID') &&
      (this.config.get('R2_BUCKET') ?? this.config.get('STORAGE_BUCKET'))
        ? 'r2'
        : 'local');
    const mailReady =
      emailProvider === 'log' ||
      (emailProvider === 'resend' && hasResend) ||
      (emailProvider === 'smtp' && hasSmtp) ||
      hasResend ||
      hasSmtp;
    const storageReady =
      storageProvider === 'local' ||
      ((storageProvider === 'r2' || storageProvider === 's3') &&
        Boolean(this.config.get('R2_BUCKET') ?? this.config.get('STORAGE_BUCKET')));
    const chain = this.blockchain.status();
    return {
      status,
      application: 'up',
      database,
      redis: cache,
      mail: {
        provider: emailProvider,
        ready: mailReady,
        fallback: hasResend && hasSmtp ? 'smtp' : null,
      },
      storage: {
        provider: storageProvider,
        ready: storageReady,
        publicUrl: Boolean(
          this.config.get('R2_PUBLIC_BASE_URL') ??
            this.config.get('STORAGE_PUBLIC_BASE_URL'),
        ),
      },
      payments: {
        provider: this.config.get('PAYSTACK_SECRET_KEY') ? 'paystack' : 'invoice',
        ready: Boolean(this.config.get('PAYSTACK_SECRET_KEY')),
      },
      blockchain: {
        enabled: chain.enabled,
        liveSubmit: chain.liveSubmit,
        chain: chain.chain.key,
        nativeCurrency: chain.chain.nativeCurrency,
      },
      environment: this.config.get<string>('NODE_ENV'),
    };
  }
}
