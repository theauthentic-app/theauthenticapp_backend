import { applyDecorators } from '@nestjs/common';
import {
  ApiBearerAuth,
  ApiHeader,
  ApiSecurity,
  ApiUnauthorizedResponse,
} from '@nestjs/swagger';

export function PartnerAuth() {
  return applyDecorators(
    ApiBearerAuth('bearer'),
    ApiSecurity('apiKey'),
    ApiHeader({
      name: 'x-organization-id',
      required: false,
      description:
        'Organization public id. Required for JWT callers; implied by API key.',
    }),
    ApiUnauthorizedResponse({
      description: 'Missing or invalid JWT / API key',
    }),
  );
}
