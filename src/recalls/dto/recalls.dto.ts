import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { RecallSeverity } from '@prisma/client';
import { IsArray, IsEnum, IsOptional, IsString } from 'class-validator';

export class CreateRecallDto {
  @ApiProperty()
  @IsString()
  recallNumber!: string;

  @ApiProperty()
  @IsString()
  reason!: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  instructions?: string;

  @ApiProperty({ enum: RecallSeverity })
  @IsEnum(RecallSeverity)
  severity!: RecallSeverity;

  @ApiProperty()
  @IsString()
  startDate!: string;

  @ApiPropertyOptional({ type: [String] })
  @IsOptional()
  @IsArray()
  @IsString({ each: true })
  batchIds?: string[];
}
