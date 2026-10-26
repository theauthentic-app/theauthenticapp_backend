import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { BrandVerificationStatus, OrganizationStatus } from '@prisma/client';
import { IsEnum, IsOptional, IsString } from 'class-validator';

export class OrgStatusDto {
  @ApiProperty({ enum: OrganizationStatus })
  @IsEnum(OrganizationStatus)
  status!: OrganizationStatus;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  notes?: string;
}

export class BrandVerifyDto {
  @ApiProperty({ enum: BrandVerificationStatus })
  @IsEnum(BrandVerificationStatus)
  verificationStatus!: BrandVerificationStatus;
}
