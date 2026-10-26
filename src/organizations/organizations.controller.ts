import { Body, Controller, Get, Param, Post, Query } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { OrganizationMemberRole } from '@prisma/client';
import {
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
import { AddMemberDto, CreateOrganizationDto } from './dto/organizations.dto';
import { OrganizationsService } from './organizations.service';

@ApiTags('organizations')
@ApiBearerAuth('bearer')
@Controller('organizations')
export class OrganizationsController {
  constructor(private readonly organizations: OrganizationsService) {}

  @HumanOnly()
  @Post()
  @ApiOperation({ summary: 'Create an organization and become owner' })
  create(@CurrentUser() user: AuthUser, @Body() dto: CreateOrganizationDto) {
    return this.organizations.create(user.id, dto);
  }

  @HumanOnly()
  @Get()
  @ApiOperation({ summary: 'List organizations for the signed-in user' })
  list(@CurrentUser() user: AuthUser) {
    return this.organizations.listForUser(user.id);
  }

  @PartnerAuth()
  @OrgRoles(
    OrganizationMemberRole.OWNER,
    OrganizationMemberRole.ADMIN,
    OrganizationMemberRole.MANAGER,
    OrganizationMemberRole.VIEWER,
    OrganizationMemberRole.ANALYST,
    OrganizationMemberRole.STAFF,
  )
  @Get('members')
  @ApiOperation({ summary: 'List organization members' })
  listMembers(
    @OrganizationId() organizationId: string,
    @Query() query: PaginationQueryDto,
  ) {
    return this.organizations.listMembers(organizationId, query);
  }

  @HumanOnly()
  @Get(':id')
  @ApiOperation({ summary: 'Get an organization the user belongs to' })
  get(@Param('id') id: string, @CurrentUser() user: AuthUser) {
    return this.organizations.getByPublicId(id, user.id);
  }

  @HumanOnly()
  @PartnerAuth()
  @OrgRoles(OrganizationMemberRole.OWNER, OrganizationMemberRole.ADMIN)
  @Post('members')
  @ApiOperation({ summary: 'Add or update an organization member' })
  addMember(
    @OrganizationId() organizationId: string | undefined,
    @CurrentUser() user: AuthUser,
    @Body() dto: AddMemberDto,
  ) {
    if (!organizationId) {
      return Promise.reject(new Error('Missing organization context'));
    }
    return this.organizations.addMember(
      organizationId,
      user.id,
      dto.email,
      dto.role,
    );
  }
}
