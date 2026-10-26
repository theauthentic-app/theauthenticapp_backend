import { Body, Controller, Get, Param, Patch, Post, Query } from '@nestjs/common';
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
import { BrandVerifyDto, OrgStatusDto } from './dto/admin.dto';

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
  ) {}

  @Get('subscribers')
  @ApiOperation({
    summary: 'Paying and trial subscribers with owner, period, and last payment',
  })
  subscribers(@Query() query: SubscribersQueryDto) {
    return this.billing.listSubscribers(query);
  }

  @Get('metrics')
  @ApiOperation({ summary: 'Platform-level operational metrics' })
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
  reports() {
    return this.prisma.productReport.findMany({
      orderBy: { createdAt: 'desc' },
      take: 50,
    });
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
