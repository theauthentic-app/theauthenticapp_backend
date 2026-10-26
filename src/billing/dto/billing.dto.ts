import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { IsIn, IsOptional, IsString, IsUrl } from 'class-validator';
import type { PlanCode } from '../plans';

export class SubscribeDto {
  @ApiProperty({ enum: ['STARTER', 'GROWTH', 'ENTERPRISE'] })
  @IsIn(['STARTER', 'GROWTH', 'ENTERPRISE'])
  planCode!: PlanCode;

  @ApiProperty()
  @IsString()
  acceptedTermsVersion!: string;

  @ApiPropertyOptional({
    description: 'Where Paystack should return the browser after checkout',
  })
  @IsOptional()
  @IsUrl({ require_tld: false })
  callbackUrl?: string;
}

export class VerifyPaymentDto {
  @ApiProperty()
  @IsString()
  reference!: string;
}

export class AdminActivatePlanDto {
  @ApiProperty({ enum: ['STARTER', 'GROWTH', 'ENTERPRISE'] })
  @IsIn(['STARTER', 'GROWTH', 'ENTERPRISE'])
  planCode!: PlanCode;
}

export class RenewDto {
  @ApiProperty()
  @IsString()
  acceptedTermsVersion!: string;

  @ApiPropertyOptional({
    description: 'Where Paystack should return the browser after checkout',
  })
  @IsOptional()
  @IsUrl({ require_tld: false })
  callbackUrl?: string;
}

export class SubscribersQueryDto {
  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  status?: string;

  @ApiPropertyOptional({ enum: ['STARTER', 'GROWTH', 'ENTERPRISE'] })
  @IsOptional()
  @IsString()
  plan?: string;

  @ApiPropertyOptional()
  @IsOptional()
  page?: number;

  @ApiPropertyOptional()
  @IsOptional()
  limit?: number;
}
