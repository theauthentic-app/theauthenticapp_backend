import { Body, Controller, Get, Post, Query } from '@nestjs/common';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import { OrganizationMemberRole } from '@prisma/client';
import { ApiScopes, OrgRoles } from '../common/decorators/auth.decorators';
import { OrganizationId } from '../common/decorators/current-user.decorator';
import { PartnerAuth } from '../common/decorators/partner-auth.decorator';
import { PaginationQueryDto } from '../common/dto/pagination.dto';
import { SupplyEventDto } from './dto/supply-chain.dto';
import { SupplyChainService } from './supply-chain.service';

@ApiTags('supply-chain')
@PartnerAuth()
@Controller('supply-chain')
export class SupplyChainController {
  constructor(private readonly supply: SupplyChainService) {}

  @OrgRoles(
    OrganizationMemberRole.OWNER,
    OrganizationMemberRole.ADMIN,
    OrganizationMemberRole.MANAGER,
    OrganizationMemberRole.STAFF,
  )
  @ApiScopes('PRODUCT_WRITE')
  @Post('events')
  @ApiOperation({ summary: 'Record a supply-chain custody event' })
  record(
    @OrganizationId() organizationId: string,
    @Body() dto: SupplyEventDto,
  ) {
    return this.supply.record(organizationId, dto);
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
  @Get('events')
  @ApiOperation({ summary: 'List supply-chain events' })
  list(
    @OrganizationId() organizationId: string,
    @Query() query: PaginationQueryDto,
  ) {
    return this.supply.list(organizationId, query);
  }
}
