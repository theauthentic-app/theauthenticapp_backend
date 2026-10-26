import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { ClientPlatform, ScanSource } from '@prisma/client';
import { Transform, Type } from 'class-transformer';
import { IsEnum, IsNumber, IsOptional, IsString } from 'class-validator';

export class VerifyDto {
  @ApiProperty()
  @IsString()
  code!: string;

  @ApiPropertyOptional({ enum: ScanSource })
  @IsOptional()
  @IsEnum(ScanSource)
  source?: ScanSource;

  @ApiPropertyOptional({ enum: ClientPlatform })
  @IsOptional()
  @IsEnum(ClientPlatform)
  platform?: ClientPlatform;

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
  @Type(() => Number)
  @IsNumber()
  latitude?: number;

  @ApiPropertyOptional()
  @IsOptional()
  @Type(() => Number)
  @IsNumber()
  longitude?: number;
}

export class ScanDto {
  @ApiPropertyOptional()
  @IsOptional()
  @Transform(({ value }) => (value === '' ? undefined : value))
  @IsString()
  code?: string;

  @ApiPropertyOptional({ enum: ScanSource })
  @IsOptional()
  @Transform(({ value }) => (value === '' ? undefined : value))
  @IsEnum(ScanSource)
  source?: ScanSource;

  @ApiPropertyOptional({ enum: ClientPlatform })
  @IsOptional()
  @Transform(({ value }) => (value === '' ? undefined : value))
  @IsEnum(ClientPlatform)
  platform?: ClientPlatform;

  @ApiPropertyOptional()
  @IsOptional()
  @Transform(({ value }) => (value === '' ? undefined : value))
  @IsString()
  country?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @Transform(({ value }) => (value === '' ? undefined : value))
  @IsString()
  city?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @Type(() => Number)
  @IsNumber()
  latitude?: number;

  @ApiPropertyOptional()
  @IsOptional()
  @Type(() => Number)
  @IsNumber()
  longitude?: number;
}
