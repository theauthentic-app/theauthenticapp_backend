import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import {
  IsArray,
  IsIn,
  IsOptional,
  IsString,
  IsUrl,
} from 'class-validator';
import { API_SCOPES, WEBHOOK_EVENTS } from '../../common/constants/api-scopes';

export class CreateApiKeyDto {
  @ApiProperty()
  @IsString()
  name!: string;

  @ApiProperty({
    type: [String],
    enum: API_SCOPES,
    example: ['PRODUCT_READ', 'PRODUCT_WRITE'],
  })
  @IsArray()
  @IsIn([...API_SCOPES], { each: true })
  scopes!: string[];

  @ApiPropertyOptional({ description: 'ISO-8601 expiry' })
  @IsOptional()
  @IsString()
  expiresAt?: string;
}

export class CreateWebhookDto {
  @ApiProperty({ example: 'https://partner.example.com/webhooks/authentic' })
  @IsString()
  @IsUrl({ require_tld: false })
  url!: string;

  @ApiProperty({
    type: [String],
    enum: WEBHOOK_EVENTS,
    example: ['verification.created'],
  })
  @IsArray()
  @IsIn([...WEBHOOK_EVENTS], { each: true })
  events!: string[];
}

export class UpdateWebhookDto {
  @ApiPropertyOptional({ enum: ['ACTIVE', 'PAUSED', 'DISABLED'] })
  @IsOptional()
  @IsIn(['ACTIVE', 'PAUSED', 'DISABLED'])
  status?: 'ACTIVE' | 'PAUSED' | 'DISABLED';
}

export class RetryDeliveryDto {
  @ApiPropertyOptional()
  @IsOptional()
  @Type(() => String)
  @IsString()
  reason?: string;
}
