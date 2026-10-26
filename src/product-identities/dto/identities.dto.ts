import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { CredentialType } from '@prisma/client';
import { Type } from 'class-transformer';
import {
  IsArray,
  IsBoolean,
  IsEnum,
  IsInt,
  IsOptional,
  IsString,
  Max,
  Min,
  ValidateNested,
} from 'class-validator';

export class ManufacturerCodeDto {
  @ApiProperty({ enum: CredentialType })
  @IsEnum(CredentialType)
  type!: CredentialType;

  @ApiProperty()
  @IsString()
  value!: string;
}

export class GenerateIdentitiesDto {
  @ApiProperty()
  @IsString()
  batchId!: string;

  @ApiProperty({ minimum: 1, maximum: 100000 })
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(100000)
  count!: number;

  @ApiPropertyOptional()
  @IsOptional()
  @IsBoolean()
  withSecurityCode?: boolean;

  @ApiPropertyOptional()
  @IsOptional()
  @IsBoolean()
  withBarcode?: boolean;

  @ApiPropertyOptional()
  @IsOptional()
  @IsBoolean()
  withDataMatrix?: boolean;

  @ApiPropertyOptional()
  @IsOptional()
  @IsBoolean()
  withNfc?: boolean;

  @ApiPropertyOptional()
  @IsOptional()
  @IsBoolean()
  withRfid?: boolean;

  @ApiPropertyOptional({ type: [ManufacturerCodeDto] })
  @IsOptional()
  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => ManufacturerCodeDto)
  manufacturerCodes?: ManufacturerCodeDto[];
}

export class IdentityActionDto {
  @ApiProperty()
  @IsString()
  identityId!: string;
}

export class AttachCredentialDto {
  @ApiProperty()
  @IsString()
  identityId!: string;

  @ApiProperty({ enum: CredentialType })
  @IsEnum(CredentialType)
  type!: CredentialType;

  @ApiProperty()
  @IsString()
  value!: string;
}
