import { Body, Controller, Get, Post, Query } from '@nestjs/common';
import {
  ApiBearerAuth,
  ApiOperation,
  ApiPropertyOptional,
  ApiTags,
} from '@nestjs/swagger';
import { Type } from 'class-transformer';
import { IsInt, IsOptional, Max, Min } from 'class-validator';
import { HumanOnly } from '../common/decorators/auth.decorators';
import { CurrentUser } from '../common/decorators/current-user.decorator';
import type { AuthUser } from '../common/decorators/current-user.decorator';
import { SaveWalletDto } from './dto/consumers.dto';
import { ConsumersService } from './consumers.service';

class ConsumerDashboardQueryDto {
  @ApiPropertyOptional({ default: 30 })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(7)
  @Max(365)
  days?: number;
}

@ApiTags('me')
@ApiBearerAuth('bearer')
@HumanOnly()
@Controller('me')
export class ConsumersController {
  constructor(private readonly consumers: ConsumersService) {}

  @Get('dashboard')
  @ApiOperation({
    summary:
      'Consumer home dashboard: stats, facts, alerts, wallet risk, timeline',
  })
  dashboard(
    @CurrentUser() user: AuthUser,
    @Query() query: ConsumerDashboardQueryDto,
  ) {
    return this.consumers.dashboard(user.id, query.days ?? 30);
  }

  @Get('reports')
  @ApiOperation({ summary: 'Reports filed by the signed-in consumer' })
  reports(@CurrentUser() user: AuthUser) {
    return this.consumers.reports(user.id);
  }

  @Get('history')
  @ApiOperation({ summary: 'Signed-in consumer verification history' })
  history(@CurrentUser() user: AuthUser) {
    return this.consumers.history(user.id);
  }

  @Get('wallet')
  @ApiOperation({ summary: 'Saved product identities' })
  wallet(@CurrentUser() user: AuthUser) {
    return this.consumers.wallet(user.id);
  }

  @Post('wallet')
  @ApiOperation({ summary: 'Save a verified identity to the product wallet' })
  saveWallet(@CurrentUser() user: AuthUser, @Body() dto: SaveWalletDto) {
    return this.consumers.saveWallet(user.id, dto.identityId);
  }
}
