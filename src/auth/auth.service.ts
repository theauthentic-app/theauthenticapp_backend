import { Injectable, UnauthorizedException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { JwtService } from '@nestjs/jwt';
import { OrganizationType, PlatformRole, UserStatus } from '@prisma/client';
import * as argon2 from 'argon2';
import { AppError } from '../common/errors/app-error';
import { publicId, randomToken, sha256 } from '../common/utils/crypto.util';
import { PrismaService } from '../database/prisma.service';
import { RedisService } from '../redis/redis.service';
import { NotificationsService } from '../notifications/notifications.service';
import { trialCreateInput } from '../billing/plans';
import { initialOrgStatus } from '../common/utils/org-status.util';
import { LoginDto, RegisterDto } from './dto/auth.dto';

const LOCK_AFTER = 8;
const LOCK_MINUTES = 15;

@Injectable()
export class AuthService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly jwt: JwtService,
    private readonly config: ConfigService,
    private readonly redis: RedisService,
    private readonly notifications: NotificationsService,
  ) {}

  async register(dto: RegisterDto) {
    const email = dto.email.toLowerCase();
    const existing = await this.prisma.user.findUnique({ where: { email } });
    if (existing) {
      throw new AppError(
        'EMAIL_IN_USE',
        'An account with that email already exists.',
        409,
      );
    }

    const passwordHash = await argon2.hash(dto.password);
    const user = await this.prisma.$transaction(async (tx) => {
      const created = await tx.user.create({
        data: {
          publicId: publicId('usr'),
          email,
          phone: dto.phone,
          passwordHash,
          firstName: dto.firstName,
          lastName: dto.lastName,
        },
      });

      if (dto.organizationName) {
        const slug = `${dto.organizationName
          .toLowerCase()
          .replace(/[^a-z0-9]+/g, '-')
          .replace(/(^-|-$)/g, '')
          .slice(0, 40)}-${Date.now().toString().slice(-4)}`;
        const org = await tx.organization.create({
          data: {
            publicId: publicId('org'),
            name: dto.organizationName,
            slug,
            type: OrganizationType.MANUFACTURER,
            status: initialOrgStatus(),
            verifiedAt:
              initialOrgStatus() === 'ACTIVE' ? new Date() : undefined,
            subscription: { create: trialCreateInput() },
          },
        });
        await tx.organizationMember.create({
          data: {
            organizationId: org.id,
            userId: created.id,
            role: 'OWNER',
          },
        });
      }
      return created;
    });

    const emailToken = randomToken();
    await this.prisma.emailVerificationToken.create({
      data: {
        userId: user.id,
        tokenHash: sha256(emailToken),
        expiresAt: new Date(Date.now() + 1000 * 60 * 60 * 24),
      },
    });
    await this.notifications.sendEmail({
      userId: user.id,
      to: user.email,
      subject: 'Confirm your AUTHENTIC email',
      template: 'verify-email',
      context: {
        firstName: user.firstName,
        token: emailToken,
        verifyUrl: this.appLink('/verify-email', { token: emailToken }),
      },
    });

    const tokens = await this.issueTokens(
      user.id,
      user.email,
      user.platformRole,
    );
    return {
      user: this.safeUser(user),
      organizations: await this.organizationsFor(user.id),
      ...tokens,
    };
  }

  async login(dto: LoginDto, meta: { ip?: string; userAgent?: string }) {
    const email = dto.email.toLowerCase();
    const rateKey = `login:${email}`;
    const attempts = await this.redis.incr(rateKey, 60 * 15);
    if (attempts > 20) {
      throw new AppError(
        'RATE_LIMITED',
        'Too many login attempts. Try again later.',
        429,
      );
    }

    const user = await this.prisma.user.findUnique({ where: { email } });
    if (!user) {
      throw new UnauthorizedException('Those credentials are not recognized.');
    }
    if (
      user.status === UserStatus.LOCKED ||
      (user.lockedUntil && user.lockedUntil > new Date())
    ) {
      throw new AppError(
        'ACCOUNT_LOCKED',
        'This account is temporarily locked.',
        423,
      );
    }
    if (user.status !== UserStatus.ACTIVE) {
      throw new AppError(
        'ACCOUNT_INACTIVE',
        'This account cannot sign in.',
        403,
      );
    }

    const ok = await argon2.verify(user.passwordHash, dto.password);
    if (!ok) {
      const failedLogins = user.failedLogins + 1;
      await this.prisma.user.update({
        where: { id: user.id },
        data: {
          failedLogins,
          lockedUntil:
            failedLogins >= LOCK_AFTER
              ? new Date(Date.now() + LOCK_MINUTES * 60 * 1000)
              : null,
          status: failedLogins >= LOCK_AFTER ? UserStatus.LOCKED : user.status,
        },
      });
      throw new UnauthorizedException('Those credentials are not recognized.');
    }

    await this.prisma.user.update({
      where: { id: user.id },
      data: {
        failedLogins: 0,
        lockedUntil: null,
        lastLoginAt: new Date(),
        status: UserStatus.ACTIVE,
      },
    });

    const tokens = await this.issueTokens(
      user.id,
      user.email,
      user.platformRole,
      meta,
    );
    return {
      user: this.safeUser(user),
      organizations: await this.organizationsFor(user.id),
      ...tokens,
    };
  }

  async refresh(refreshToken: string) {
    const tokenHash = sha256(refreshToken);
    const stored = await this.prisma.refreshToken.findUnique({
      where: { tokenHash },
      include: { user: true },
    });
    if (!stored || stored.revokedAt || stored.expiresAt < new Date()) {
      throw new UnauthorizedException('Refresh token is not valid.');
    }

    await this.prisma.refreshToken.update({
      where: { id: stored.id },
      data: { revokedAt: new Date() },
    });

    const tokens = await this.issueTokens(
      stored.user.id,
      stored.user.email,
      stored.user.platformRole,
    );
    await this.prisma.refreshToken.update({
      where: { id: stored.id },
      data: { replacedBy: sha256(tokens.refreshToken) },
    });
    return tokens;
  }

  async logout(refreshToken: string) {
    const tokenHash = sha256(refreshToken);
    await this.prisma.refreshToken.updateMany({
      where: { tokenHash, revokedAt: null },
      data: { revokedAt: new Date() },
    });
    return { revoked: true };
  }

  async verifyEmail(token: string) {
    const tokenHash = sha256(token);
    const record = await this.prisma.emailVerificationToken.findUnique({
      where: { tokenHash },
    });
    if (!record || record.usedAt || record.expiresAt < new Date()) {
      throw new AppError(
        'INVALID_TOKEN',
        'Email verification token is invalid.',
        400,
      );
    }
    await this.prisma.$transaction([
      this.prisma.emailVerificationToken.update({
        where: { id: record.id },
        data: { usedAt: new Date() },
      }),
      this.prisma.user.update({
        where: { id: record.userId },
        data: { emailVerifiedAt: new Date() },
      }),
    ]);
    const user = await this.prisma.user.findUnique({
      where: { id: record.userId },
    });
    if (user) {
      const membership = await this.prisma.organizationMember.findFirst({
        where: { userId: user.id },
        include: { organization: true },
      });
      await this.notifications.sendEmail({
        userId: user.id,
        to: user.email,
        subject: 'Welcome to AUTHENTIC',
        template: 'welcome',
        context: {
          firstName: user.firstName,
          organizationName: membership?.organization.name,
          verifyUrl: this.appLink('/login'),
        },
      });
    }
    return { verified: true };
  }

  async resendVerification(email: string) {
    const user = await this.prisma.user.findUnique({
      where: { email: email.toLowerCase() },
    });
    if (!user || user.emailVerifiedAt) return { queued: true };
    await this.prisma.emailVerificationToken.updateMany({
      where: { userId: user.id, usedAt: null },
      data: { usedAt: new Date() },
    });
    const emailToken = randomToken();
    await this.prisma.emailVerificationToken.create({
      data: {
        userId: user.id,
        tokenHash: sha256(emailToken),
        expiresAt: new Date(Date.now() + 1000 * 60 * 60 * 24),
      },
    });
    await this.notifications.sendEmail({
      userId: user.id,
      to: user.email,
      subject: 'Confirm your AUTHENTIC email',
      template: 'verify-email',
      context: {
        firstName: user.firstName,
        token: emailToken,
        verifyUrl: this.appLink('/verify-email', { token: emailToken }),
      },
    });
    return { queued: true };
  }

  async forgotPassword(email: string) {
    const normalized = email.toLowerCase();
    const attempts = await this.redis.incr(`forgot:${normalized}`, 60 * 60);
    if (attempts > 8) {
      throw new AppError(
        'RATE_LIMITED',
        'Too many password reset requests. Try again later.',
        429,
      );
    }
    const user = await this.prisma.user.findUnique({
      where: { email: normalized },
    });
    if (!user) return { queued: true };
    await this.prisma.passwordReset.updateMany({
      where: { userId: user.id, usedAt: null },
      data: { usedAt: new Date() },
    });
    const token = randomToken();
    await this.prisma.passwordReset.create({
      data: {
        userId: user.id,
        tokenHash: sha256(token),
        expiresAt: new Date(Date.now() + 1000 * 60 * 30),
      },
    });
    await this.notifications.sendEmail({
      userId: user.id,
      to: user.email,
      subject: 'Reset your AUTHENTIC password',
      template: 'reset-password',
      context: {
        firstName: user.firstName,
        token,
        resetUrl: this.appLink('/reset-password', { token }),
      },
    });
    return { queued: true };
  }

  async resetPassword(token: string, password: string) {
    const record = await this.prisma.passwordReset.findUnique({
      where: { tokenHash: sha256(token) },
    });
    if (!record || record.usedAt || record.expiresAt < new Date()) {
      throw new AppError(
        'INVALID_TOKEN',
        'Password reset token is invalid.',
        400,
      );
    }
    const passwordHash = await argon2.hash(password);
    await this.prisma.$transaction([
      this.prisma.passwordReset.update({
        where: { id: record.id },
        data: { usedAt: new Date() },
      }),
      this.prisma.user.update({
        where: { id: record.userId },
        data: {
          passwordHash,
          failedLogins: 0,
          lockedUntil: null,
          status: UserStatus.ACTIVE,
        },
      }),
      this.prisma.refreshToken.updateMany({
        where: { userId: record.userId, revokedAt: null },
        data: { revokedAt: new Date() },
      }),
    ]);
    return { reset: true };
  }

  async profile(userId: string) {
    const record = await this.prisma.user.findUnique({
      where: { id: userId },
    });
    if (!record) {
      throw new UnauthorizedException('Session is no longer valid.');
    }
    return {
      user: this.safeUser(record),
      organizations: await this.organizationsFor(record.id),
    };
  }

  private async organizationsFor(userId: string) {
    const memberships = await this.prisma.organizationMember.findMany({
      where: { userId },
      include: { organization: true },
    });
    return memberships.map((m) => ({
      id: m.organization.publicId,
      name: m.organization.name,
      type: m.organization.type,
      role: m.role,
      status: m.organization.status,
    }));
  }

  private async issueTokens(
    userId: string,
    email: string,
    platformRole: PlatformRole,
    meta?: { ip?: string; userAgent?: string },
  ) {
    const accessToken = await this.jwt.signAsync({
      sub: userId,
      email,
      platformRole,
    });
    const refreshToken = randomToken(48);
    const ttl = this.config.get<string>('JWT_REFRESH_TTL') ?? '14d';
    const days = ttl.endsWith('d') ? Number(ttl.slice(0, -1)) : 14;
    await this.prisma.refreshToken.create({
      data: {
        userId,
        tokenHash: sha256(refreshToken),
        expiresAt: new Date(Date.now() + days * 86400000),
        ipHash: meta?.ip ? sha256(meta.ip) : null,
        userAgent: meta?.userAgent?.slice(0, 250),
      },
    });
    return { accessToken, refreshToken, tokenType: 'Bearer' as const };
  }

  private appLink(path: string, query?: Record<string, string>) {
    const base = this.config.get<string>('APP_WEB_URL') ?? 'http://localhost:3000';
    const url = new URL(path.replace(/^\//, ''), `${base.replace(/\/$/, '')}/`);
    for (const [key, value] of Object.entries(query ?? {})) {
      url.searchParams.set(key, value);
    }
    return url.toString();
  }

  private safeUser(user: {
    publicId: string;
    email: string;
    firstName: string;
    lastName: string;
    platformRole: PlatformRole;
    emailVerifiedAt: Date | null;
  }) {
    return {
      id: user.publicId,
      email: user.email,
      firstName: user.firstName,
      lastName: user.lastName,
      platformRole: user.platformRole,
      emailVerified: Boolean(user.emailVerifiedAt),
    };
  }
}
