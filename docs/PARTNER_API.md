# AUTHENTIC Partner API (sellable surface)

This is the commercial packaging guide for the Nest API. Interactive OpenAPI: **`GET /docs`** (Swagger UI) when `SWAGGER_ENABLED` is not `false`.

Base URL: `{host}/api/v1`

---

## Why partners buy this

| Capability | Value |
| --- | --- |
| Serialized identities | Mint, activate, revoke, export labels |
| Consumer verify | Public scan + evidence statuses + trust score |
| Brand protection | Risk signals, counterfeit intel, recalls, reports |
| Integration | API keys, signed webhooks, idempotent writes |
| Analytics | Role-aware dashboard modules + trends |

**Positioning:** evidence platform — not a lab certificate or “fake detector.”

---

## Auth models

1. **Dashboard JWT** — human users; require `x-organization-id`.
2. **API key** — `X-API-Key: atk_live_…`; org implied; scopes:
   - `VERIFY`
   - `PRODUCT_READ` / `PRODUCT_WRITE`
   - `ANALYTICS_READ`
   - `WEBHOOKS`
3. **Public** — `/public/verify`, `/public/scan`, `/public/pricing`, `/public/blog`.

---

## Core partner flows

### A. Issue identities

```
POST /brands → POST /products → POST /product-variants → POST /batches
POST /product-identities/generate  (Idempotency-Key recommended)
GET  /product-identities/export?format=csv|pdf
```

### B. Verify in the wild

```
POST /public/verify   { code, lat?, lng?, … }
POST /public/scan     multipart image
```

### C. Protect the brand

```
GET /analytics/dashboard
GET /risk-signals
GET /intel/counterfeit
GET /reports
POST /recalls
GET /supply-chain/events
```

### D. Automate

```
POST /api-keys
POST /webhooks
Events: verification.created, risk.detected
```

---

## Dashboard modules (OEM UI)

`GET /analytics/dashboard` → `data.modules[]` describes:

Products · Batches · Verifications · Risk Signals · Counterfeit Intel · Supply Chain · Recall Center · Warranties · Analytics · API Access

Each includes KPIs, `status`, `href`, and `api` hints for white-label frontends.

---

## Content / SEO

| Method | Path | Auth |
| --- | --- | --- |
| GET | `/public/blog` | Public |
| GET | `/public/blog/:slug` | Public |
| CRUD | `/admin/blog` | Platform ADMIN |

Use for marketing SEO; not part of the paid verify SKU.

---

## Platform security ops

| Method | Path | Notes |
| --- | --- | --- |
| GET | `/admin/users?q=` | Search |
| PATCH | `/admin/users/:id/status` | `SUSPENDED` ban / `ACTIVE` restore; revokes refresh tokens |
| JWT | — | Rejects non-ACTIVE users on every request |

---

## Error codes (common)

| Code | Meaning |
| --- | --- |
| `EMAIL_NOT_VERIFIED` | Complete OTP |
| `ACCOUNT_BANNED` | Suspended user |
| `FORBIDDEN` | Role / scope |
| `RATE_LIMITED` | Throttle |
| `INVALID_CODE` / `INVALID_TOKEN` | Auth OTP / links |

---

## Versioning & SLA notes for sales

- Current version: **1.1** (OpenAPI `info.version`).
- Breaking changes require a new `/api/v2` prefix (future).
- Quotas enforced per subscription plan (identities, verifications, brands, API keys).
- Webhook signatures: `X-Authentic-Signature: sha256=…`

Export OpenAPI JSON from Swagger UI or `npm run docs:openapi` when configured.
