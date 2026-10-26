import {
  Body,
  Controller,
  Get,
  Param,
  Post,
  Query,
  Req,
  UploadedFile,
  UseInterceptors,
} from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import {
  ApiBody,
  ApiConsumes,
  ApiOperation,
  ApiTags,
} from '@nestjs/swagger';
import { OrganizationMemberRole, ScanSource } from '@prisma/client';
import type { Request } from 'express';
import {
  ApiScopes,
  OrgRoles,
  Public,
} from '../common/decorators/auth.decorators';
import {
  CurrentUser,
  OrganizationId,
  Principal,
} from '../common/decorators/current-user.decorator';
import type { AuthUser } from '../common/decorators/current-user.decorator';
import { PartnerAuth } from '../common/decorators/partner-auth.decorator';
import { PaginationQueryDto } from '../common/dto/pagination.dto';
import { AppError } from '../common/errors/app-error';
import type { RequestPrincipal } from '../common/types/request-principal';
import { sha256 } from '../common/utils/crypto.util';
import { RedisService } from '../redis/redis.service';
import {
  BarcodeDecoderService,
  pickBestSymbol,
} from './barcode-decoder.service';
import { ScanDto, VerifyDto } from './dto/verification.dto';
import { VerificationService } from './verification.service';

@ApiTags('verification')
@Controller()
export class VerificationController {
  constructor(
    private readonly verification: VerificationService,
    private readonly decoder: BarcodeDecoderService,
    private readonly redis: RedisService,
  ) {}

  @Public()
  @Post('public/verify')
  @ApiOperation({
    summary: 'Public product verification. Does not require an account.',
  })
  async publicVerify(
    @Body() dto: VerifyDto,
    @Req() req: Request,
    @CurrentUser() user?: AuthUser,
  ) {
    await this.rateLimit(req.ip ?? 'unknown');
    return this.verification.verify({
      ...dto,
      audience: 'public',
      userId: user?.id,
      ip: req.ip,
      userAgent: req.headers['user-agent'],
    });
  }

  @Public()
  @Post('public/scan')
  @UseInterceptors(
    FileInterceptor('image', { limits: { fileSize: 8 * 1024 * 1024 } }),
  )
  @ApiConsumes('multipart/form-data')
  @ApiBody({
    schema: {
      type: 'object',
      properties: {
        image: { type: 'string', format: 'binary' },
        code: { type: 'string' },
        source: { type: 'string' },
        platform: { type: 'string' },
        country: { type: 'string' },
        city: { type: 'string' },
        latitude: { type: 'number' },
        longitude: { type: 'number' },
      },
    },
  })
  @ApiOperation({
    summary:
      'Decode a barcode/QR/ISBN photo on the server, then verify or look the product up worldwide.',
  })
  async publicScan(
    @UploadedFile() file: Express.Multer.File | undefined,
    @Body() dto: ScanDto,
    @Req() req: Request,
    @CurrentUser() user?: AuthUser,
  ) {
    await this.rateLimit(req.ip ?? 'unknown');
    const symbols = file
      ? await this.decoder.decode(file.buffer, file.mimetype)
      : [];
    const best = pickBestSymbol(symbols);
    const code = dto.code?.trim() || best?.text;
    if (!code) {
      throw new AppError(
        symbols.length ? 'NO_CODE' : 'NO_BARCODE',
        file
          ? 'No barcode, QR code, ISBN, or serial was readable in that image.'
          : 'Upload an image or provide a code.',
        422,
      );
    }
    return this.verification.verify({
      code,
      alternateCodes: symbols
        .map((symbol) => symbol.text)
        .filter((text) => text !== code),
      decodedFromImage: Boolean(file),
      symbols,
      source: dto.source ?? (file ? ScanSource.CAMERA : ScanSource.MANUAL),
      platform: dto.platform,
      country: dto.country,
      city: dto.city,
      latitude: dto.latitude,
      longitude: dto.longitude,
      audience: 'public',
      userId: user?.id,
      ip: req.ip,
      userAgent: req.headers['user-agent'],
    });
  }

  @Public()
  @Post('verifications')
  @ApiOperation({ summary: 'Create a verification (public or authenticated)' })
  async create(
    @Body() dto: VerifyDto,
    @Req() req: Request,
    @CurrentUser() user?: AuthUser,
    @Principal() principal?: RequestPrincipal,
  ) {
    await this.rateLimit(req.ip ?? 'unknown');
    if (
      principal?.kind === 'apiKey' &&
      !principal.scopes.includes('VERIFY')
    ) {
      throw new AppError(
        'INSUFFICIENT_SCOPE',
        'API key is missing required scope: VERIFY.',
        403,
      );
    }
    const partner = Boolean(user) || principal?.kind === 'apiKey';
    return this.verification.verify({
      ...dto,
      audience: partner ? 'enterprise' : 'public',
      userId: user?.id,
      ip: req.ip,
      userAgent: req.headers['user-agent'],
    });
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
  @Get('analytics/verifications')
  @ApiOperation({ summary: 'Paginated verification events for the organization' })
  listForOrg(
    @OrganizationId() organizationId: string,
    @Query() query: PaginationQueryDto,
  ) {
    return this.verification.listForOrganization(organizationId, query);
  }

  @Public()
  @Get('verifications/:id')
  @ApiOperation({ summary: 'Fetch a public verification result' })
  get(@Param('id') id: string) {
    return this.verification.getByPublicId(id, 'public');
  }

  @Public()
  @Get('products/:id/passport')
  @ApiOperation({ summary: 'Digital product passport for a public identity' })
  async passport(@Param('id') id: string) {
    const passport = await this.verification.lookupPassport(id);
    if (!passport) {
      throw new AppError(
        'NOT_FOUND',
        'No product passport is available for that identity.',
        404,
      );
    }
    return passport;
  }

  private async rateLimit(ip: string) {
    const count = await this.redis.incr(`rl:verify:${sha256(ip)}`, 60);
    if (count > 120) {
      throw new AppError(
        'RATE_LIMITED',
        'Verification rate limit exceeded.',
        429,
      );
    }
  }
}
