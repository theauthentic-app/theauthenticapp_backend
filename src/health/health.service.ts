import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { PrismaService } from '../database/prisma.service';
import { RedisService } from '../redis/redis.service';

@Injectable()
export class HealthService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly redis: RedisService,
    private readonly config: ConfigService,
  ) {}

  async check() {
    const [database, cache] = await Promise.all([
      this.prisma.$queryRaw`SELECT 1`.then(() => 'up').catch(() => 'down'),
      this.redis.ping().then((ok) => (ok ? 'up' : 'down')),
    ]);
    const status = database === 'up' ? 'ok' : 'degraded';
    const emailProvider =
      this.config.get<string>('EMAIL_PROVIDER')?.toLowerCase() ||
      (this.config.get('RESEND_API_KEY')
        ? 'resend'
        : this.config.get('SMTP_HOST')
          ? 'smtp'
          : 'log');
    const storageProvider =
      this.config.get<string>('STORAGE_PROVIDER')?.toLowerCase() ||
      (this.config.get('R2_ACCOUNT_ID') &&
      this.config.get('R2_ACCESS_KEY_ID') &&
      (this.config.get('R2_BUCKET') ?? this.config.get('STORAGE_BUCKET'))
        ? 'r2'
        : 'local');
    const mailReady =
      emailProvider === 'log' ||
      (emailProvider === 'resend' && Boolean(this.config.get('RESEND_API_KEY'))) ||
      ((emailProvider === 'smtp' || emailProvider === 'nodemailer') &&
        Boolean(this.config.get('SMTP_HOST')));
    const storageReady =
      storageProvider === 'local' ||
      ((storageProvider === 'r2' || storageProvider === 's3') &&
        Boolean(this.config.get('R2_BUCKET') ?? this.config.get('STORAGE_BUCKET')));
    return {
      status,
      application: 'up',
      database,
      redis: cache,
      mail: { provider: emailProvider, ready: mailReady },
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
      environment: this.config.get<string>('NODE_ENV'),
    };
  }
}
