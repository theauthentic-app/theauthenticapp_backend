import { Body, Controller, Get, Post, Query } from '@nestjs/common';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import { OrganizationMemberRole } from '@prisma/client';
import {
  ApiScopes,
  OrgRoles,
  Public,
} from '../common/decorators/auth.decorators';
import {
  CurrentUser,
  OrganizationId,
} from '../common/decorators/current-user.decorator';
import type { AuthUser } from '../common/decorators/current-user.decorator';
import { PartnerAuth } from '../common/decorators/partner-auth.decorator';
import { PaginationQueryDto } from '../common/dto/pagination.dto';
import { CreateReportDto } from './dto/reports.dto';
import { ReportsService } from './reports.service';

@ApiTags('reports')
@Controller('reports')
export class ReportsController {
  constructor(private readonly reports: ReportsService) {}

  @Public()
  @Post()
  @ApiOperation({ summary: 'Report a suspicious product' })
  create(@Body() dto: CreateReportDto, @CurrentUser() user?: AuthUser) {
    return this.reports.create({ ...dto, userId: user?.id });
  }

  @PartnerAuth()
  @OrgRoles(
    OrganizationMemberRole.OWNER,
    OrganizationMemberRole.ADMIN,
    OrganizationMemberRole.MANAGER,
    OrganizationMemberRole.ANALYST,
    OrganizationMemberRole.VIEWER,
    OrganizationMemberRole.STAFF,
  )
  @ApiScopes('ANALYTICS_READ')
  @Get()
  @ApiOperation({ summary: 'Product reports against this organization catalog' })
  list(
    @OrganizationId() organizationId: string,
    @Query() query: PaginationQueryDto,
  ) {
    return this.reports.listForOrganization(organizationId, query);
  }
}
