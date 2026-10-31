import { Controller, Get, Query } from '@nestjs/common';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import { OrganizationMemberRole } from '@prisma/client';
import { ApiScopes, OrgRoles } from '../common/decorators/auth.decorators';
import {
  MembershipRole,
  OrganizationId,
} from '../common/decorators/current-user.decorator';
import { PartnerAuth } from '../common/decorators/partner-auth.decorator';
import { AnalyticsService } from './analytics.service';
import { DashboardQueryDto } from './dto/analytics.dto';

@ApiTags('analytics')
@PartnerAuth()
@Controller('analytics')
export class AnalyticsController {
  constructor(private readonly analytics: AnalyticsService) {}

  @OrgRoles(
    OrganizationMemberRole.OWNER,
    OrganizationMemberRole.ADMIN,
    OrganizationMemberRole.MANAGER,
    OrganizationMemberRole.ANALYST,
    OrganizationMemberRole.VIEWER,
    OrganizationMemberRole.STAFF,
  )
  @ApiScopes('ANALYTICS_READ')
  @Get('dashboard')
  @ApiOperation({
    summary:
      'Role-aware brand dashboard: protection KPIs, insights, ops, finance, team',
  })
  dashboard(
    @OrganizationId() organizationId: string,
    @MembershipRole() role: OrganizationMemberRole | undefined,
    @Query() query: DashboardQueryDto,
  ) {
    return this.analytics.dashboard(organizationId!, query, role);
  }
}
