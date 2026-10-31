import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { OrganizationMemberRole, OrganizationType } from '@prisma/client';
import { IsEmail, IsEnum, IsOptional, IsString } from 'class-validator';

export class CreateOrganizationDto {
  @ApiProperty()
  @IsString()
  name!: string;

  @ApiProperty({ enum: OrganizationType })
  @IsEnum(OrganizationType)
  type!: OrganizationType;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  country?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  city?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  legalName?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  registrationNumber?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  website?: string;
}

export class AddMemberDto {
  @ApiProperty()
  @IsEmail()
  email!: string;

  @ApiProperty({ enum: OrganizationMemberRole })
  @IsEnum(OrganizationMemberRole)
  role!: OrganizationMemberRole;
}

export class UpdateMemberRoleDto {
  @ApiProperty({ enum: OrganizationMemberRole })
  @IsEnum(OrganizationMemberRole)
  role!: OrganizationMemberRole;
}
