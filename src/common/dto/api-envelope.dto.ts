import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';

export class ApiErrorBody {
  @ApiProperty({ example: 'PRODUCT_NOT_FOUND' })
  code!: string;

  @ApiProperty({ example: 'Product not found.' })
  message!: string;
}

export class ApiErrorResponse {
  @ApiProperty({ example: false })
  success!: false;

  @ApiProperty({ type: ApiErrorBody })
  error!: ApiErrorBody;

  @ApiProperty({ example: '2026-09-26T17:00:00.000Z' })
  timestamp!: string;

  @ApiPropertyOptional({ example: '7f3c1d2e-4a5b-6789-abcd-ef0123456789' })
  requestId?: string;
}

export class ApiSuccessResponse {
  @ApiProperty({ example: true })
  success!: true;

  @ApiProperty({ description: 'Endpoint-specific payload' })
  data!: unknown;

  @ApiProperty({ example: '2026-09-26T17:00:00.000Z' })
  timestamp!: string;

  @ApiPropertyOptional({ example: '7f3c1d2e-4a5b-6789-abcd-ef0123456789' })
  requestId?: string;
}
