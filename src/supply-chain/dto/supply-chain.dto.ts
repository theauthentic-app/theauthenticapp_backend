import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { SupplyChainEventType } from '@prisma/client';
import { IsEnum, IsOptional, IsString } from 'class-validator';

export class SupplyEventDto {
  @ApiProperty()
  @IsString()
  identityId!: string;

  @ApiProperty({ enum: SupplyChainEventType })
  @IsEnum(SupplyChainEventType)
  type!: SupplyChainEventType;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  location?: string;
}
