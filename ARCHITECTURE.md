# Architecture

AUTHENTIC backend is a **modular monolith**. Domain modules share one PostgreSQL database and one NestJS process. They can be split later without rewriting the verification contract.

```
Organization → Brand → Product → Variant → Batch → ProductIdentity → Credential
                                                              ↓
                                                      Verification → RiskSignal
```

## Source of truth

The backend calculates verification status and trust score. Clients may not supply status, score, role, or ownership.

## Partner edge

Dashboard users send a JWT plus `x-organization-id`. Integrations send `X-API-Key: atk_live_…`. The composite auth guard tries the API key first, then JWT. API keys bind `request.organizationId` from the key; scopes replace org-role checks. Platform admin routes stay human-only.

```
PartnerApp -- JWT or X-API-Key --> Auth + OrgRoles + ApiScopes
                                 --> domain modules --> PostgreSQL
                                 --> WebhookDelivery PENDING
Webhook worker (every 5s) --> HMAC POST --> partner URL
OpenAPI at /docs and docs/openapi.json
```

Webhook deliveries retry with backoff and pause an endpoint after repeated failures. URLs are checked so production hooks cannot target private/loopback addresses.

## Modules

| Module | Responsibility |
| --- | --- |
| auth / users | Registration, JWT, refresh rotation, lockout |
| organizations | Multi-tenant membership and RBAC |
| products | Brands, products, variants, batches |
| product-identities | Secure bulk identity + credential issuance (QR, serial, barcode, Data Matrix, NFC, RFID, ISBN) |
| verification | Credential resolution, image decode, scoring, scan persistence |
| catalog-lookup | Worldwide ISBN/GTIN enrichment (Open Library, Google Books, Open Food Facts) |
| trust-score | Weighted evidence scoring |
| risk | Impossible travel and other signals; AI provider is a no-op stub |
| recalls / warranties / reports / supply-chain | Enterprise lifecycle |
| api-keys / webhooks | Partner access, signed delivery worker |
| admin | Platform operators |
| files / notifications | Storage and message abstractions |

## Verification

1. Optionally decode a photo (JPEG/PNG/WebP/GIF/BMP) with ZXing; never persist the image.
2. Canonicalize the presented code (ISBN-10→13, GTIN padding, AUTHENTIC QR/serial).
3. Hash the presented code; never store raw scan payloads as the lookup key.
4. Resolve `Credential → ProductIdentity → Variant → Product → Brand → Organization`.
5. Validate HMAC signature with server-side issuer secret.
6. Evaluate recall, expiry, revocation, frequency, geography.
7. If no identity matches, try the local GTIN/ISBN catalog, then public worldwide catalogs.
8. Persist a verification event and optional risk signals.
9. Return evidence-based status, never ORIGINAL/FAKE. Include `scan` and `lookup` metadata.

Public callers receive a reduced payload. Enterprise callers (authenticated) receive additional signals.

## Caching

Redis is used for rate limits and short-lived verification keys. Identity revoke/recall/compromise deletes `verify:{code}` keys.

## Mail and storage

Email uses Handlebars templates. `EMAIL_PROVIDER=log|smtp|resend`. Notifications are persisted, then sent (or logged) immediately.

Uploads use `STORAGE_PROVIDER=local|r2`. Cloudflare R2 is S3-compatible (`R2_ACCOUNT_ID`, `R2_ACCESS_KEY_ID`, `R2_SECRET_ACCESS_KEY`, `R2_BUCKET`, optional `R2_PUBLIC_BASE_URL`).
