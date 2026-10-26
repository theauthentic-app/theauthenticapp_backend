import { DocumentBuilder } from '@nestjs/swagger';

export function buildSwaggerConfig() {
  return new DocumentBuilder()
    .setTitle('AUTHENTIC API')
    .setDescription(
      [
        'Partner API for product identity, consumer verification, and brand protection.',
        '',
        'Authenticate dashboard users with a JWT (`Authorization: Bearer <token>`) plus `x-organization-id`.',
        'Authenticate integrations with `X-API-Key: atk_live_…` (or the same value as a Bearer token).',
        'API keys imply the organization; scopes replace org-role checks.',
        '',
        'Successful responses: `{ success: true, data, timestamp, requestId }`.',
        'Errors: `{ success: false, error: { code, message }, timestamp, requestId }`.',
        'List endpoints return `{ items, page, limit, total }` inside `data`.',
        '',
        'MVP loop: register manufacturer → create catalog → POST /product-identities/generate → GET export/label → POST /public/verify or open /scan.',
        'Pay: POST /billing/subscribe. If PAYSTACK_SECRET_KEY is set, complete checkout; otherwise an admin activates the invoice.',
      ].join('\n'),
    )
    .setVersion('1.0.0')
    .setContact('AUTHENTIC', 'https://authentic.app', 'partners@authentic.app')
    .addServer('/api/v1', 'Versioned API prefix (already applied to paths)')
    .addBearerAuth(
      { type: 'http', scheme: 'bearer', bearerFormat: 'JWT' },
      'bearer',
    )
    .addApiKey(
      {
        type: 'apiKey',
        name: 'X-API-Key',
        in: 'header',
        description: 'Live partner key (`atk_live_…`)',
      },
      'apiKey',
    )
    .addApiKey(
      {
        type: 'apiKey',
        name: 'x-organization-id',
        in: 'header',
        description: 'Organization public id. Required for JWT; implied by API key.',
      },
      'organization',
    )
    .addTag('health', 'Liveness and dependency checks')
    .addTag('auth', 'User registration and session')
    .addTag('organizations', 'Workspaces and members')
    .addTag('catalog', 'Brands, products, variants, batches')
    .addTag('identities', 'Serialized product identities and credentials')
    .addTag('verification', 'Scan and verify product codes')
    .addTag('analytics', 'Brand-protection metrics')
    .addTag('platform', 'API keys and webhooks')
    .addTag('reports', 'Consumer product reports')
    .addTag('recalls', 'Recall campaigns')
    .addTag('warranties', 'Warranty register')
    .addTag('supply-chain', 'Custody events')
    .addTag('billing', 'Plans, usage, and legal')
    .addTag('files', 'Uploads')
    .addTag('me', 'Consumer history and wallet')
    .addTag('admin', 'Platform operators')
    .build();
}
