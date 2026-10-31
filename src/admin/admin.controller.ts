import {
  Body,
  Controller,
  Get,
  NotFoundException,
  Param,
  Patch,
  Post,
  Query,
} from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { OrganizationStatus } from '@prisma/client';
import { HumanOnly, PlatformRoles } from '../common/decorators/auth.decorators';
import { CurrentUser } from '../common/decorators/current-user.decorator';
import type { AuthUser } from '../common/decorators/current-user.decorator';
import { PrismaService } from '../database/prisma.service';
import { AuditService } from '../audit/audit.service';
import { BillingService } from '../billing/billing.service';
import {
  AdminActivatePlanDto,
  SubscribersQueryDto,
} from '../billing/dto/billing.dto';
import { NotificationsService } from '../notifications/notifications.service';
import { AdminService } from './admin.service';
import { AdminDashboardQueryDto } from './dto/admin-dashboard.dto';
import {
  AdminReportStatusDto,
  AdminUserStatusDto,
  BrandVerifyDto,
  OrgStatusDto,
} from './dto/admin.dto';
import { AppError } from '../common/errors/app-error';
import { UserStatus } from '@prisma/client';

@ApiTags('admin')
@ApiBearerAuth('bearer')
@HumanOnly()
@PlatformRoles('ADMIN', 'SUPER_ADMIN')
@Controller('admin')
export class AdminController {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
    private readonly billing: BillingService,
    private readonly notifications: NotificationsService,
    private readonly admin: AdminService,
  ) {}

  @Get('dashboard')
  @ApiOperation({
    summary:
      'Fat platform admin dashboard: growth, revenue, geo, funnel, KYC, health',
  })
  dashboard(@Query() query: AdminDashboardQueryDto) {
    return this.admin.dashboard(query);
  }

  @Get('users')
  @ApiOperation({ summary: 'Search platform users' })
  async users(@Query('q') q?: string) {
    const term = (q ?? '').trim();
    const users = await this.prisma.user.findMany({
      where: term
        ? {
            OR: [
              { email: { contains: term, mode: 'insensitive' } },
              { firstName: { contains: term, mode: 'insensitive' } },
              { lastName: { contains: term, mode: 'insensitive' } },
              { publicId: { contains: term, mode: 'insensitive' } },
            ],
          }
        : undefined,
      orderBy: { createdAt: 'desc' },
      take: 50,
      select: {
        publicId: true,
        email: true,
        firstName: true,
        lastName: true,
        status: true,
        platformRole: true,
        emailVerifiedAt: true,
        createdAt: true,
        lastLoginAt: true,
      },
    });
    return users.map((u) => ({
      id: u.publicId,
      email: u.email,
      firstName: u.firstName,
      lastName: u.lastName,
      status: u.status,
      platformRole: u.platformRole,
      emailVerified: Boolean(u.emailVerifiedAt),
      createdAt: u.createdAt,
      lastLoginAt: u.lastLoginAt,
    }));
  }

  @Patch('users/:id/status')
  @ApiOperation({
    summary: 'Ban (SUSPENDED) or restore (ACTIVE) a user; revokes refresh tokens',
  })
  async setUserStatus(
    @Param('id') id: string,
    @Body() dto: AdminUserStatusDto,
    @CurrentUser() actor: AuthUser,
  ) {
    if (
      dto.status !== UserStatus.ACTIVE &&
      dto.status !== UserStatus.SUSPENDED
    ) {
      throw new AppError(
        'INVALID_STATUS',
        'Only ACTIVE or SUSPENDED are allowed here.',
        400,
      );
    }
    const user = await this.prisma.user.findFirst({
      where: { OR: [{ publicId: id }, { id }] },
    });
    if (!user) {
      throw new NotFoundException('User not found.');
    }
    if (
      (user.platformRole === 'ADMIN' || user.platformRole === 'SUPER_ADMIN') &&
      dto.status === UserStatus.SUSPENDED &&
      actor.platformRole !== 'SUPER_ADMIN'
    ) {
      throw new AppError(
        'FORBIDDEN',
        'Only SUPER_ADMIN can suspend platform admins.',
        403,
      );
    }
    const updated = await this.prisma.user.update({
      where: { id: user.id },
      data: {
        status: dto.status,
        lockedUntil: null,
        failedLogins: dto.status === UserStatus.ACTIVE ? 0 : user.failedLogins,
      },
    });
    if (dto.status === UserStatus.SUSPENDED) {
      await this.prisma.refreshToken.updateMany({
        where: { userId: user.id, revokedAt: null },
        data: { revokedAt: new Date() },
      });
    }
    await this.audit.record({
      action: 'USER_STATUS_CHANGED',
      actorUserId: actor.id,
      entity: 'User',
      entityId: user.id,
      metadata: { status: dto.status, reason: dto.reason },
    });
    return {
      id: updated.publicId,
      status: updated.status,
      banned: updated.status === UserStatus.SUSPENDED,
    };
  }

  @Get('subscribers')
  @ApiOperation({
    summary: 'Paying and trial subscribers with owner, period, and last payment',
  })
  subscribers(@Query() query: SubscribersQueryDto) {
    return this.billing.listSubscribers(query);
  }

  @Get('metrics')
  @ApiOperation({
    summary:
      'Legacy headline counts — prefer GET /admin/dashboard for charts',
  })
  async metrics() {
    const [users, organizations, identities, verifications, reports] =
      await Promise.all([
        this.prisma.user.count(),
        this.prisma.organization.count(),
        this.prisma.productIdentity.count(),
        this.prisma.verification.count(),
        this.prisma.productReport.count(),
      ]);
    return { users, organizations, identities, verifications, reports };
  }

  @Get('reports')
  @ApiOperation({ summary: 'Latest consumer reports across the platform' })
  async reports() {
    const rows = await this.prisma.productReport.findMany({
      orderBy: { createdAt: 'desc' },
      take: 50,
      include: {
        user: { select: { publicId: true, email: true } },
        productIdentity: { select: { publicId: true } },
      },
    });
    return rows.map((r) => ({
      id: r.publicId,
      reason: r.reason,
      status: r.status,
      description: r.description,
      city: r.city,
      country: r.country,
      reviewOutcome: r.reviewOutcome,
      createdAt: r.createdAt,
      identityId: r.productIdentity?.publicId ?? null,
      reporter: r.user
        ? { id: r.user.publicId, email: r.user.email }
        : null,
    }));
  }

  @Patch('reports/:id')
  @ApiOperation({ summary: 'Triage a consumer report (status + outcome)' })
  async updateReport(
    @Param('id') id: string,
    @Body() dto: AdminReportStatusDto,
    @CurrentUser() user: AuthUser,
  ) {
    const existing = await this.prisma.productReport.findUnique({
      where: { publicId: id },
    });
    if (!existing) {
      throw new NotFoundException('Report not found.');
    }
    const report = await this.prisma.productReport.update({
      where: { publicId: id },
      data: {
        status: dto.status,
        reviewOutcome: dto.reviewOutcome,
      },
    });
    await this.audit.record({
      action: 'REPORT_REVIEWED',
      actorUserId: user.id,
      entity: 'ProductReport',
      entityId: report.id,
      metadata: { status: dto.status, reviewOutcome: dto.reviewOutcome },
    });
    return {
      id: report.publicId,
      status: report.status,
      reviewOutcome: report.reviewOutcome,
    };
  }

  @Get('organizations')
  @ApiOperation({ summary: 'List organizations for KYC review' })
  async organizations() {
    const orgs = await this.prisma.organization.findMany({
      orderBy: { createdAt: 'desc' },
      take: 100,
      include: { subscription: true },
    });
    return orgs.map((org) => ({
      id: org.publicId,
      name: org.name,
      status: org.status,
      kycNotes: org.kycNotes,
      plan: org.subscription?.planCode,
      subscriptionStatus: org.subscription?.status,
      createdAt: org.createdAt,
    }));
  }

  @Patch('organizations/:id')
  @ApiOperation({ summary: 'Approve, suspend, or reject an organization (KYC)' })
  async updateOrganization(
    @Param('id') id: string,
    @Body() dto: OrgStatusDto,
    @CurrentUser() user: AuthUser,
  ) {
    const org = await this.prisma.organization.update({
      where: { publicId: id },
      data: {
        status: dto.status,
        kycNotes: dto.notes,
        verifiedAt:
          dto.status === OrganizationStatus.ACTIVE ? new Date() : null,
      },
    });
    await this.audit.record({
      action: 'ORGANIZATION_UPDATED',
      actorUserId: user.id,
      organizationId: org.id,
      entity: 'Organization',
      entityId: org.id,
      metadata: { status: dto.status, notes: dto.notes },
    });
    if (dto.status === OrganizationStatus.ACTIVE) {
      this.notifications.notifyOrganizationSafe(org.id, {
        subject: 'Your AUTHENTIC workspace is approved',
        template: 'org-approved',
      });
    }
    return { id: org.publicId, status: org.status, kycNotes: org.kycNotes };
  }

  @Post('organizations/:id/activate-plan')
  @ApiOperation({
    summary: 'Activate a paid plan after invoice payment (no Paystack)',
  })
  activatePlan(
    @Param('id') id: string,
    @Body() dto: AdminActivatePlanDto,
    @CurrentUser() user: AuthUser,
  ) {
    return this.billing.adminActivate(id, dto.planCode, user.id);
  }

  @Patch('brands/:id')
  @ApiOperation({ summary: 'Set brand verification status' })
  async verifyBrand(
    @Param('id') id: string,
    @Body() dto: BrandVerifyDto,
    @CurrentUser() user: AuthUser,
  ) {
    const brand = await this.prisma.brand.update({
      where: { publicId: id },
      data: { verificationStatus: dto.verificationStatus },
    });
    await this.audit.record({
      action: 'BRAND_VERIFIED',
      actorUserId: user.id,
      organizationId: brand.organizationId,
      entity: 'Brand',
      entityId: brand.id,
      metadata: { verificationStatus: dto.verificationStatus },
    });
    return { id: brand.publicId, verificationStatus: brand.verificationStatus };
  }
}
