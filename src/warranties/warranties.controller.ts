import { Body, Controller, Get, Post, Query } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { OrganizationMemberRole } from '@prisma/client';
import {
  ApiScopes,
  HumanOnly,
  OrgRoles,
} from '../common/decorators/auth.decorators';
import {
  CurrentUser,
  OrganizationId,
} from '../common/decorators/current-user.decorator';
import type { AuthUser } from '../common/decorators/current-user.decorator';
import { PartnerAuth } from '../common/decorators/partner-auth.decorator';
import { PaginationQueryDto } from '../common/dto/pagination.dto';
import { RegisterWarrantyDto } from './dto/warranties.dto';
import { WarrantiesService } from './warranties.service';

@ApiTags('warranties')
@Controller('warranties')
export class WarrantiesController {
  constructor(private readonly warranties: WarrantiesService) {}

  @ApiBearerAuth('bearer')
  @HumanOnly()
  @Post()
  @ApiOperation({ summary: 'Register a consumer warranty' })
  register(@CurrentUser() user: AuthUser, @Body() dto: RegisterWarrantyDto) {
    return this.warranties.register(user.id, dto.identityId);
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
  @ApiScopes('PRODUCT_READ')
  @Get()
  @ApiOperation({ summary: 'List warranties for the organization' })
  list(
    @OrganizationId() organizationId: string,
    @Query() query: PaginationQueryDto,
  ) {
    return this.warranties.listForOrganization(organizationId, query);
  }
}
