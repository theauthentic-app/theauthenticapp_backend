import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import {
  BrandVerificationStatus,
  OrganizationStatus,
  ReportStatus,
  UserStatus,
} from '@prisma/client';
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

export class AdminReportStatusDto {
  @ApiProperty({ enum: ReportStatus })
  @IsEnum(ReportStatus)
  status!: ReportStatus;

  @ApiPropertyOptional({ description: 'Reviewer outcome notes' })
  @IsOptional()
  @IsString()
  reviewOutcome?: string;
}

export class AdminUserStatusDto {
  @ApiProperty({
    enum: [UserStatus.ACTIVE, UserStatus.SUSPENDED, UserStatus.LOCKED],
    description: 'SUSPENDED = ban (cannot sign in; JWTs rejected)',
  })
  @IsEnum(UserStatus)
  status!: UserStatus;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  reason?: string;
}
