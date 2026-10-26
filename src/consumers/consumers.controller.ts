import { Body, Controller, Get, Post } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { HumanOnly } from '../common/decorators/auth.decorators';
import { CurrentUser } from '../common/decorators/current-user.decorator';
import type { AuthUser } from '../common/decorators/current-user.decorator';
import { SaveWalletDto } from './dto/consumers.dto';
import { ConsumersService } from './consumers.service';

@ApiTags('me')
@ApiBearerAuth('bearer')
@HumanOnly()
@Controller('me')
export class ConsumersController {
  constructor(private readonly consumers: ConsumersService) {}

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
