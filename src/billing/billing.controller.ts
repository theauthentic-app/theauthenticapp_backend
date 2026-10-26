import {
  Body,
  Controller,
  Get,
  Headers,
  Post,
  Query,
  Req,
} from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { OrganizationMemberRole } from '@prisma/client';
import type { RawBodyRequest } from '@nestjs/common';
import type { Request } from 'express';
import {
  ApiScopes,
  HumanOnly,
  OrgRoles,
  Public,
} from '../common/decorators/auth.decorators';
import {
  CurrentUser,
  OrganizationId,
} from '../common/decorators/current-user.decorator';
import type { AuthUser } from '../common/decorators/current-user.decorator';
import { PartnerAuth } from '../common/decorators/partner-auth.decorator';
import { AppError } from '../common/errors/app-error';
import { BillingService } from './billing.service';
import { RenewDto, SubscribeDto, VerifyPaymentDto } from './dto/billing.dto';

@ApiTags('billing')
@Controller()
export class BillingController {
  constructor(private readonly billing: BillingService) {}

  @Public()
  @Get('public/pricing')
  @ApiOperation({ summary: 'Public manufacturer pricing catalog in NGN' })
  pricing() {
    return this.billing.catalog();
  }

  @Public()
  @Get('public/legal/terms')
  @ApiOperation({ summary: 'Current commercial terms' })
  terms() {
    return this.billing.terms();
  }

  @Public()
  @Get('public/legal/privacy')
  @ApiOperation({ summary: 'Privacy notice' })
  privacy() {
    return this.billing.privacy();
  }

  @Public()
  @Get('public/billing/config')
  @ApiOperation({
    summary: 'Whether Paystack checkout is live. Empty keys = invoice mode.',
  })
  paymentConfig() {
    return this.billing.paymentMode();
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
  @ApiScopes('ANALYTICS_READ')
  @Get('billing')
  @ApiOperation({ summary: 'Plan, usage, remaining quotas, and payment status' })
  snapshot(@OrganizationId() organizationId: string) {
    return this.billing.snapshot(organizationId);
  }

  @ApiBearerAuth('bearer')
  @HumanOnly()
  @OrgRoles(OrganizationMemberRole.OWNER, OrganizationMemberRole.ADMIN)
  @Post('billing/subscribe')
  @ApiOperation({
    summary:
      'Start a plan. If PAYSTACK_SECRET_KEY is set, returns a checkout URL. Otherwise invoice + admin activate.',
  })
  subscribe(
    @OrganizationId() organizationId: string,
    @CurrentUser() user: AuthUser | undefined,
    @Body() dto: SubscribeDto,
  ) {
    if (!user) {
      throw new AppError('UNAUTHORIZED', 'Sign in to subscribe.', 401);
    }
    return this.billing.subscribe(
      organizationId,
      dto.planCode,
      dto.acceptedTermsVersion,
      { email: user.email, userId: user.id },
      dto.callbackUrl,
    );
  }

  @ApiBearerAuth('bearer')
  @HumanOnly()
  @OrgRoles(OrganizationMemberRole.OWNER, OrganizationMemberRole.ADMIN)
  @Post('billing/renew')
  @ApiOperation({
    summary:
      'Renew the current plan. Paystack checkout if keys are set, otherwise invoice.',
  })
  renew(
    @OrganizationId() organizationId: string,
    @CurrentUser() user: AuthUser | undefined,
    @Body() dto: RenewDto,
  ) {
    if (!user) {
      throw new AppError('UNAUTHORIZED', 'Sign in to renew.', 401);
    }
    return this.billing.renew(
      organizationId,
      dto.acceptedTermsVersion,
      { email: user.email, userId: user.id },
      dto.callbackUrl,
    );
  }

  @Public()
  @Get('billing/paystack/verify')
  @ApiOperation({ summary: 'Confirm a Paystack reference after checkout return' })
  verify(@Query() query: VerifyPaymentDto) {
    return this.billing.verifyReference(query.reference);
  }

  @Public()
  @Post('billing/paystack/webhook')
  @ApiOperation({ summary: 'Paystack charge.success webhook' })
  webhook(
    @Req() req: RawBodyRequest<Request>,
    @Headers('x-paystack-signature') signature?: string,
  ) {
    const raw = req.rawBody;
    if (!raw) {
      throw new AppError(
        'INVALID_SIGNATURE',
        'Raw webhook body is missing.',
        400,
      );
    }
    return this.billing.handlePaystackWebhook(raw, signature);
  }
}
