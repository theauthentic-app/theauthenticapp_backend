import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { FilePurpose } from '@prisma/client';
import { IsEnum, IsOptional, IsString } from 'class-validator';

export class UploadDto {
  @ApiProperty({ enum: FilePurpose })
  @IsEnum(FilePurpose)
  purpose!: FilePurpose;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  originalName?: string;
}
