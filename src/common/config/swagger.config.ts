import { DocumentBuilder } from '@nestjs/swagger';

export function buildSwaggerConfig() {
  return new DocumentBuilder()
    .setTitle('AUTHENTIC Partner API')
    .setDescription(
      [
        '# Overview',
        'Commercial partner API for **product identity**, **consumer verification**, **brand protection**, and **platform content**.',
        '',
        'Use this OpenAPI document to integrate manufacturer dashboards, mobile scanners, and B2B partners — or to package AUTHENTIC as a sellable API product.',
        '',
        '## Authentication',
        '- **Human (dashboard):** `Authorization: Bearer <accessToken>` + `x-organization-id: org_…`',
        '- **Machine (partner):** `X-API-Key: atk_live_…` (organization implied; scopes replace org roles)',
        '- **Public:** scan/verify, pricing, published blog — no auth',
        '',
        '## Envelope',
        '- Success: `{ success: true, data, timestamp, requestId }`',
        '- Error: `{ success: false, error: { code, message }, timestamp, requestId }`',
        '- Lists: `data: { items, page, limit, total }`',
        '',
        '## Product truth',
        'Verification statuses are evidence (`AUTHENTICATED`, `SUSPICIOUS`, `COMPROMISED`, …). Clients must **not** invent “original/fake” labels.',
        '',
        '## Manufacturer cockpit modules',
        '`GET /analytics/dashboard` returns `modules[]` for Products, Batches, Verifications, Risk Signals, Counterfeit Intel, Supply Chain, Recalls, Warranties, Analytics, and API Access — each with KPIs, status, and API hints.',
        '',
        '## Commercial packaging',
        'Plan features gate API keys/webhooks (`billing.assertFeature`). Scope keys: `VERIFY`, `PRODUCT_READ`, `PRODUCT_WRITE`, `ANALYTICS_READ`, `WEBHOOKS`.',
      ].join('\n'),
    )
    .setVersion('1.1.0')
    .setContact('AUTHENTIC Partners', 'https://authentic.app', 'partners@authentic.app')
    .setLicense('Proprietary', 'https://authentic.app/legal/terms')
    .addServer('/api/v1', 'Versioned API (paths already include this prefix in Nest)')
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
    .addTag('auth', 'Registration, OTP verify, session, password reset')
    .addTag('organizations', 'Workspaces and members')
    .addTag('catalog', 'Brands, products, variants, batches')
    .addTag('identities', 'Serialized product identities and credentials')
    .addTag('verification', 'Public and partner scan / verify')
    .addTag('analytics', 'Manufacturer dashboard + verification history')
    .addTag('risk', 'Risk signals (clone, travel, frequency)')
    .addTag('intel', 'Counterfeit intel evidence cockpit')
    .addTag('platform', 'API keys and webhooks (Growth+)')
    .addTag('reports', 'Consumer product reports')
    .addTag('recalls', 'Recall campaigns')
    .addTag('warranties', 'Warranty register')
    .addTag('supply-chain', 'Custody events')
    .addTag('billing', 'Plans, usage, Paystack / invoice')
    .addTag('files', 'Uploads (R2 / local)')
    .addTag('me', 'Consumer dashboard, history, wallet, reports')
    .addTag('blog', 'Public SEO blog + admin CMS')
    .addTag('admin', 'Platform operators: KYC, bans, metrics, blog')
    .addTag('blockchain', 'Identity commitment anchors')
    .build();
}
