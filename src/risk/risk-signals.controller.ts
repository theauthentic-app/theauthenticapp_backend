import { Controller, Get, Query } from '@nestjs/common';
import { ApiOperation, ApiPropertyOptional, ApiTags } from '@nestjs/swagger';
import { OrganizationMemberRole, RiskSeverity, RiskType } from '@prisma/client';
import { IsEnum, IsOptional } from 'class-validator';
import { ApiScopes, OrgRoles } from '../common/decorators/auth.decorators';
import { OrganizationId } from '../common/decorators/current-user.decorator';
import { PartnerAuth } from '../common/decorators/partner-auth.decorator';
import { PaginationQueryDto } from '../common/dto/pagination.dto';
import { RiskSignalsService } from './risk-signals.service';

class RiskSignalsQueryDto extends PaginationQueryDto {
  @ApiPropertyOptional({ enum: RiskSeverity })
  @IsOptional()
  @IsEnum(RiskSeverity)
  severity?: RiskSeverity;

  @ApiPropertyOptional({ enum: RiskType })
  @IsOptional()
  @IsEnum(RiskType)
  type?: RiskType;
}

@ApiTags('risk')
@PartnerAuth()
@Controller('risk-signals')
export class RiskSignalsController {
  constructor(private readonly risk: RiskSignalsService) {}

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
  @ApiOperation({
    summary: 'List risk signals for the organization (cloning, travel, etc.)',
  })
  list(
    @OrganizationId() organizationId: string,
    @Query() query: RiskSignalsQueryDto,
  ) {
    return this.risk.listForOrganization(organizationId!, query);
  }
}
