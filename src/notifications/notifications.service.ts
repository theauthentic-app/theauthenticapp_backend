import { Injectable, Logger } from '@nestjs/common';
import { NotificationChannel, OrganizationMemberRole, Prisma } from '@prisma/client';
import { env } from '../common/utils/env.util';
import { PrismaService } from '../database/prisma.service';
import { MailService, type MailTemplate } from '../mail/mail.service';
import { RedisService } from '../redis/redis.service';

@Injectable()
export class NotificationsService {
  private readonly logger = new Logger(NotificationsService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly mail: MailService,
    private readonly redis: RedisService,
  ) {}

  async enqueue(input: {
    userId: string;
    channel: NotificationChannel;
    title: string;
    body: string;
    metadata?: Record<string, unknown>;
  }) {
    return this.prisma.notification.create({
      data: {
        userId: input.userId,
        channel: input.channel,
        title: input.title,
        body: input.body,
        metadata:
          (input.metadata as Prisma.InputJsonValue | undefined) ?? undefined,
        status: 'QUEUED',
      },
    });
  }

  async sendEmail(input: {
    userId: string;
    to: string;
    subject: string;
    template: MailTemplate;
    context: Record<string, unknown>;
    preview?: string;
  }) {
    const record = await this.enqueue({
      userId: input.userId,
      channel: 'EMAIL',
      title: input.subject,
      body: input.preview ?? input.subject,
      metadata: { template: input.template },
    });
    try {
      const result = await this.mail.send({
        to: input.to,
        subject: input.subject,
        template: input.template,
        context: input.context,
      });
      await this.prisma.notification.update({
        where: { id: record.id },
        data: { status: result.delivered ? 'SENT' : 'QUEUED' },
      });
      return result;
    } catch (error) {
      this.logger.error(
        `Failed to send ${input.template} to ${input.to}: ${String(error)}`,
      );
      await this.prisma.notification.update({
        where: { id: record.id },
        data: { status: 'FAILED' },
      });
      return { delivered: false, provider: this.mail.provider() };
    }
  }

  async notifyOrganization(
    organizationId: string,
    input: {
      subject: string;
      template: MailTemplate;
      context?: Record<string, unknown>;
      onceKey?: string;
      onceTtlSeconds?: number;
    },
  ) {
    if (input.onceKey) {
      const first = await this.redis.setIfAbsent(
        input.onceKey,
        '1',
        input.onceTtlSeconds ?? 86_400,
      );
      if (!first) return { delivered: false, skipped: true };
    }
    const [org, members] = await Promise.all([
      this.prisma.organization.findUnique({ where: { id: organizationId } }),
      this.prisma.organizationMember.findMany({
        where: {
          organizationId,
          role: {
            in: [OrganizationMemberRole.OWNER, OrganizationMemberRole.ADMIN],
          },
        },
        include: {
          user: { select: { id: true, email: true, firstName: true } },
        },
      }),
    ]);
    const dashboardUrl = `${(env('APP_WEB_URL') ?? 'http://localhost:3001').replace(/\/$/, '')}/app`;
    const results = [];
    for (const member of members) {
      results.push(
        await this.sendEmail({
          userId: member.user.id,
          to: member.user.email,
          subject: input.subject,
          template: input.template,
          context: {
            firstName: member.user.firstName,
            organizationName: org?.name ?? 'your workspace',
            dashboardUrl,
            ...(input.context ?? {}),
          },
        }),
      );
    }
    return {
      delivered: results.some((result) => result.delivered),
      recipients: members.length,
    };
  }

  notifyOrganizationSafe(
    organizationId: string,
    input: {
      subject: string;
      template: MailTemplate;
      context?: Record<string, unknown>;
      onceKey?: string;
      onceTtlSeconds?: number;
    },
  ) {
    void this.notifyOrganization(organizationId, input).catch((error) => {
      this.logger.error(
        `Org email ${input.template} failed: ${String(error)}`,
      );
    });
  }
}
