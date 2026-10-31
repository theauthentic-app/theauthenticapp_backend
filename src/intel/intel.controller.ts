import { Controller, Get, Query } from '@nestjs/common';
import { ApiOperation, ApiPropertyOptional, ApiTags } from '@nestjs/swagger';
import { OrganizationMemberRole } from '@prisma/client';
import { Type } from 'class-transformer';
import { IsInt, IsOptional, Max, Min } from 'class-validator';
import { ApiScopes, OrgRoles } from '../common/decorators/auth.decorators';
import { OrganizationId } from '../common/decorators/current-user.decorator';
import { PartnerAuth } from '../common/decorators/partner-auth.decorator';
import { IntelService } from './intel.service';

class IntelQueryDto {
  @ApiPropertyOptional({ default: 30 })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(365)
  days?: number;
}

@ApiTags('intel')
@PartnerAuth()
@Controller('intel')
export class IntelController {
  constructor(private readonly intel: IntelService) {}

  @OrgRoles(
    OrganizationMemberRole.OWNER,
    OrganizationMemberRole.ADMIN,
    OrganizationMemberRole.MANAGER,
    OrganizationMemberRole.ANALYST,
    OrganizationMemberRole.VIEWER,
    OrganizationMemberRole.STAFF,
  )
  @ApiScopes('ANALYTICS_READ')
  @Get('counterfeit')
  @ApiOperation({
    summary:
      'Counterfeit intel cockpit: reports, compromised scans, clone signals (evidence only)',
  })
  counterfeit(
    @OrganizationId() organizationId: string,
    @Query() query: IntelQueryDto,
  ) {
    return this.intel.counterfeit(organizationId!, query.days ?? 30);
  }
}
