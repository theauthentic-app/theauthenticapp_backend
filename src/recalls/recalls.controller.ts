import { Body, Controller, Get, Post, Query } from '@nestjs/common';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import { OrganizationMemberRole } from '@prisma/client';
import { ApiScopes, OrgRoles } from '../common/decorators/auth.decorators';
import {
  ActorId,
  OrganizationId,
} from '../common/decorators/current-user.decorator';
import { PartnerAuth } from '../common/decorators/partner-auth.decorator';
import { PaginationQueryDto } from '../common/dto/pagination.dto';
import { CreateRecallDto } from './dto/recalls.dto';
import { RecallsService } from './recalls.service';

@ApiTags('recalls')
@PartnerAuth()
@Controller('recalls')
export class RecallsController {
  constructor(private readonly recalls: RecallsService) {}

  @OrgRoles(
    OrganizationMemberRole.OWNER,
    OrganizationMemberRole.ADMIN,
    OrganizationMemberRole.MANAGER,
  )
  @ApiScopes('PRODUCT_WRITE')
  @Post()
  @ApiOperation({ summary: 'Create a recall campaign' })
  create(
    @OrganizationId() organizationId: string,
    @ActorId() actorId: string | undefined,
    @Body() dto: CreateRecallDto,
  ) {
    return this.recalls.create(organizationId, actorId, dto);
  }

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
  @ApiOperation({ summary: 'List recalls' })
  list(
    @OrganizationId() organizationId: string,
    @Query() query: PaginationQueryDto,
  ) {
    return this.recalls.list(organizationId, query);
  }
}
