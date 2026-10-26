# AUTHENTIC Partner API

Base URL: `{API_BASE_URL}/api/v1` (default `http://localhost:3001/api/v1`).

Versioning lives in the path. `v1` is the current contract. We will not remove or rename fields without a new version or a documented deprecation window of at least 90 days.

Interactive docs: [`/docs`](http://localhost:3001/docs)  
Machine-readable spec: [`/docs-json`](http://localhost:3001/docs-json) and committed [`docs/openapi.json`](docs/openapi.json).

## Envelope

Success:

```json
{
  "success": true,
  "data": {},
  "timestamp": "2026-09-26T17:00:00.000Z",
  "requestId": "…"
}
```

Error:

```json
{
  "success": false,
  "error": { "code": "PRODUCT_NOT_FOUND", "message": "…" },
  "timestamp": "2026-09-26T17:00:00.000Z",
  "requestId": "…"
}
```

Every response includes `x-request-id`. Send the same header to correlate retries.

## Authentication

Two callers, one contract.

| Caller | How | Organization | Authorization |
| --- | --- | --- | --- |
| Dashboard user | `Authorization: Bearer <jwt>` | Required `x-organization-id` | Org membership role |
| Partner integration | `X-API-Key: atk_live_…` (or the same value as Bearer) | Implied by the key | API key scopes |

API keys are issued on Growth and Enterprise plans: `POST /api-keys`. The secret is shown once.

### Scopes

| Scope | Use |
| --- | --- |
| `PRODUCT_READ` | Brands, products, batches, identities, recalls, warranties, supply-chain |
| `PRODUCT_WRITE` | Create/update catalog, generate/activate/revoke identities, files, recalls, events |
| `VERIFY` | Authenticated `POST /verifications` (enterprise payload) |
| `ANALYTICS_READ` | Dashboard, verification history, reports, billing snapshot |
| `WEBHOOKS` | API keys, webhook endpoints, deliveries |

Public consumer routes (`/public/verify`, `/public/scan`, auth, health, pricing) stay unauthenticated.

User-only routes (`/auth/me`, `/me/*`, create organization, subscribe, admin) reject API keys.

## Pagination

List endpoints accept `page` (default 1) and `limit` (default 20, max 100) and return:

```json
{ "items": [], "page": 1, "limit": 20, "total": 0 }
```

## Idempotency

Send `Idempotency-Key` on `POST /product-identities/generate`, `POST /product-identities/activate`, and `POST /webhooks`. Replays return the stored body for 24 hours.

## Quickstart (Swagger or manufacturer app)

Manufacturer UI: `/app` · Consumer scan: `/scan` · Swagger: `/docs`

1. `POST /auth/register` with `organizationName` (trial starts; org is ACTIVE unless `ORG_KYC_REQUIRED=true`).
2. Create brand → product → batch.
3. `POST /product-identities/generate` — response includes `verifyUrl`, `labelUrl`, and CSV/PDF export links.
4. Open `/scan?code=<publicId>` or `POST /public/verify`.
5. `GET /product-identities/export?format=csv|pdf` to print packs.
6. `POST /billing/subscribe` — if `PAYSTACK_SECRET_KEY` is set you get a checkout URL; otherwise invoice + `POST /admin/organizations/:id/activate-plan`.

## Webhooks

Events: `verification.created`, `risk.detected`.

Delivery body:

```json
{
  "eventId": "evt_…",
  "eventType": "verification.created",
  "createdAt": "2026-09-26T17:00:00.000Z",
  "data": {}
}
```

Headers: `X-Authentic-Event`, `X-Authentic-Delivery-Id`, `X-Authentic-Signature: sha256=<hex>`.

Retries: 5 attempts (5s, 30s, 2m, 10m, 1h). After 10 consecutive failures the endpoint is paused.

Private/loopback URLs are rejected in production.

### Verify a signature (Node)

```js
const crypto = require('crypto');
const expected = crypto
  .createHmac('sha256', process.env.WEBHOOK_SECRET)
  .update(rawBody)
  .digest('hex');
const header = request.headers['x-authentic-signature'] ?? '';
const given = header.replace(/^sha256=/, '');
const ok = crypto.timingSafeEqual(Buffer.from(expected), Buffer.from(given));
```

### Verify a signature (Python)

```python
import hashlib, hmac, os
expected = hmac.new(os.environ["WEBHOOK_SECRET"].encode(), raw_body, hashlib.sha256).hexdigest()
given = header.removeprefix("sha256=")
ok = hmac.compare_digest(expected, given)
```

## Error codes

`UNAUTHORIZED`, `FORBIDDEN`, `INVALID_SCOPE`, `INSUFFICIENT_SCOPE`, `RATE_LIMITED`, `API_KEY_NOT_FOUND`, `WEBHOOK_NOT_FOUND`, `DELIVERY_NOT_FOUND`, `INVALID_WEBHOOK_URL`, `INVALID_WEBHOOK_EVENT`, `PRODUCT_NOT_FOUND`, `IDENTITY_NOT_FOUND`, `ORGANIZATION_NOT_FOUND`, `VALIDATION` / `BAD_REQUEST`.

## Rate limits

Per minute, Redis-backed: public 60, JWT 120, API key 300 (`THROTTLE_*` env). Public verify also has a 120/min IP limiter.

## Compatibility

Additive JSON fields are not breaking. Removing or renaming fields, changing status enums, or changing webhook signatures requires a new major version or a deprecation notice.

## Changelog

- 2026-09-26 — Partner platform: API-key auth, complete OpenAPI, pagination, signed webhook delivery, Redis rate limits, idempotency.
