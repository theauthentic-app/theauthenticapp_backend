# Frontend ↔ AUTHENTIC Backend integration guide

How the web/mobile frontend should talk to this API: auth, envelopes, every major endpoint group, expected payloads, and the end-to-end product flows.

Interactive contract: `{API}/docs` · Partner notes: [API.md](../API.md) · Env: [ENV.md](ENV.md)

---

## 1. Architecture: how the pieces fit

```
┌─────────────────────────────┐         HTTPS JSON          ┌──────────────────────────┐
│  Frontend (Vercel / app)    │  ─────────────────────────► │  Nest API (Render/Contabo)│
│  authentic-web-platform…   │  ◄───────────────────────── │  /api/v1/*               │
│  /verify, /business, /auth  │         envelope + data     │  Postgres · Redis · R2   │
└─────────────────────────────┘                             └──────────────────────────┘
         │                                                            │
         │ opens /scan?code=pid_… or calls verify                     │ mints QR → APP_WEB_URL/scan
         ▼                                                            ▼
   Consumer sees status                                      Manufacturer mints identities
```

| Concern | Owner |
| --- | --- |
| UI, routing, camera UX | Frontend |
| Auth session storage | Frontend (`accessToken`, `refreshToken`, `orgId`) |
| Truth of verification status / trust score | **Backend only** — never invent pass/fail in the UI |
| Product catalog, identities, billing | Backend |
| Public image CDN URLs | Backend (R2) → frontend just renders `url` |

**Base URL (production example):**

```text
NEXT_PUBLIC_API_URL=https://YOUR-SERVICE.onrender.com/api/v1
```

Local: `http://localhost:3001/api/v1`  
Health (no prefix): `GET https://YOUR-HOST/health`

CORS: backend `CORS_ORIGINS` must include your Vercel origin (`https://authentic-web-platform.vercel.app`).

---

## 2. Response envelope (every JSON route)

Success:

```json
{
  "success": true,
  "data": { },
  "timestamp": "2026-10-26T18:00:00.000Z",
  "requestId": "uuid"
}
```

Error (`4xx` / `5xx`):

```json
{
  "success": false,
  "error": {
    "code": "PRODUCT_NOT_FOUND",
    "message": "Product not found."
  },
  "timestamp": "2026-10-26T18:00:00.000Z",
  "requestId": "uuid"
}
```

**Frontend rule:** always read `body.data` on success and `body.error.code` / `message` on failure. Header `x-request-id` matches `requestId` (send it back when reporting bugs).

**Exceptions (not enveloped):** binary downloads — CSV/PDF/PNG labels and public file streams (`Content-Type: image/*` or `application/pdf`).

### Suggested client helper

```ts
const API = process.env.NEXT_PUBLIC_API_URL!; // …/api/v1

type Envelope<T> = {
  success: boolean;
  data?: T;
  error?: { code: string; message: string };
  requestId?: string;
};

export async function api<T>(
  path: string,
  opts: RequestInit & { token?: string; orgId?: string; json?: unknown } = {},
): Promise<T> {
  const headers = new Headers(opts.headers);
  if (opts.json !== undefined) headers.set('Content-Type', 'application/json');
  if (opts.token) headers.set('Authorization', `Bearer ${opts.token}`);
  if (opts.orgId) headers.set('x-organization-id', opts.orgId);

  const res = await fetch(`${API}${path}`, {
    ...opts,
    headers,
    body: opts.json !== undefined ? JSON.stringify(opts.json) : opts.body,
  });

  const contentType = res.headers.get('content-type') || '';
  if (!contentType.includes('application/json')) {
    if (!res.ok) throw new Error(res.statusText);
    return res as unknown as T; // caller handles blob
  }

  const body = (await res.json()) as Envelope<T>;
  if (!res.ok || body.success === false) {
    const err = new Error(body.error?.message || res.statusText) as Error & {
      code?: string;
      status?: number;
    };
    err.code = body.error?.code;
    err.status = res.status;
    throw err;
  }
  return body.data as T;
}
```

---

## 3. Auth model (what the frontend must store)

### 3.1 Human users (dashboard / consumer account)

| Item | Storage | Usage |
| --- | --- | --- |
| `accessToken` | memory + `localStorage` / httpOnly cookie | `Authorization: Bearer …` |
| `refreshToken` | secure storage | `POST /auth/refresh` when access expires |
| `orgId` | local preference | `x-organization-id: org_…` on **manufacturer** routes |
| `user` | cache from `/auth/me` | UI chrome |

Without `x-organization-id`, org-scoped routes fail even with a valid JWT.

### 3.2 Partner integrations (optional)

`X-API-Key: atk_live_…` — org is implied by the key. Not for the Vercel consumer UI.

### 3.3 Auth endpoints

| Method | Path | Auth | Body / notes | `data` shape (typical) |
| --- | --- | --- | --- | --- |
| `POST` | `/auth/register` | Public | `email`, `password` (≥10), `firstName`, `lastName`, optional `organizationName`, `phone` | `{ user, organizations[], emailVerificationRequired, emailDelivered }` — **no tokens** until verify |
| `POST` | `/auth/login` | Public | `email`, `password` | tokens + orgs; `EMAIL_NOT_VERIFIED` if unverified |
| `POST` | `/auth/refresh` | Public | `refreshToken` | new token pair |
| `POST` | `/auth/logout` | Public | `refreshToken` | `{ revoked: true }` |
| `POST` | `/auth/verify-email` | Public | `{ email, code }` **or** `{ token }` | `{ verified, user, organizations, accessToken, refreshToken }` |
| `POST` | `/auth/resend-verification` | Public | `email` | `{ queued, emailDelivered }` — new 6-digit code |

**Auth UX:** [FRONTEND_AUTH.md](./FRONTEND_AUTH.md) · **OTP:** [FRONTEND_EMAIL_VERIFICATION.md](./FRONTEND_EMAIL_VERIFICATION.md)  
**Manufacturer cockpit (10 modules):** [FRONTEND_MANUFACTURER.md](./FRONTEND_MANUFACTURER.md)  
**Dashboards:** [FRONTEND_DASHBOARDS.md](./FRONTEND_DASHBOARDS.md)  
**Sellable partner API:** [PARTNER_API.md](./PARTNER_API.md) · Swagger `/docs`
| `POST` | `/auth/forgot-password` | Public | `email` | `{ queued: true }` |
| `POST` | `/auth/reset-password` | Public | `token`, `password` | `{ reset: true }` |
| `GET` | `/auth/me` | Bearer (human) | — | profile + `organizations[]` |

**Register with `organizationName`:** creates a manufacturer workspace + trial subscription.  
**Register without it:** consumer account; they can `POST /organizations` later or just verify products.

### 3.4 Seamless session flow

```
login/register
  → save accessToken, refreshToken
  → if organizations[0], save orgId = organizations[0].id
  → on 401: refresh once → retry; if refresh fails → logout
  → manufacturer pages: always send x-organization-id
  → consumer /verify: usually no org header
```

---

## 4. Verification statuses (display rules)

Backend never returns `ORIGINAL` / `FAKE`. Map these in UI copy carefully:

| `status` | Meaning for UI |
| --- | --- |
| `AUTHENTICATED` | Unit matched a signed AUTHENTIC identity |
| `SUSPICIOUS` | Matched but risk signals (travel, frequency, etc.) |
| `COMPROMISED` | Clone / credential abuse suspected |
| `RECALLED` | Batch/identity under recall |
| `REVOKED` | Manufacturer revoked the unit |
| `UNVERIFIED` | Not an AUTHENTIC unit; optional public catalog hit (ISBN/GTIN) |
| `NOT_FOUND` / similar codes | No record — show “we could not verify”, not “fake” |

Also show: `trustScore` (0–100), `guidance` (server-written copy), `warnings[]`, `reasons[]`.

---

## 5. Consumer / verify surfaces

Used by pages like [authentic-web-platform.vercel.app/verify](https://authentic-web-platform.vercel.app/verify).

| Method | Path | Auth | Request | `data` highlights |
| --- | --- | --- | --- | --- |
| `POST` | `/public/verify` | Public | JSON `{ code, source?, platform?, country?, city?, latitude?, longitude? }` | Full verify result (below) |
| `POST` | `/public/scan` | Public | `multipart/form-data`: `image` + optional `code`, `source` | Same shape; may include `scan.decodedFromImage` |
| `POST` | `/verifications` | Public or JWT | Same as verify | Prefer `/public/verify` for consumers |
| `GET` | `/verifications/:id` | Public | — | Cached result by `verificationId` |
| `GET` | `/products/:id/passport` | Public | identity or product public id | Digital passport summary |
| `GET` | `/products/:id` | Public | product public id | Public product + images |
| `POST` | `/reports` | Public | suspicious product report | Created report |
| `GET` | `/me/history` | Bearer | — | Consumer’s past scans |
| `GET` | `/me/wallet` | Bearer | — | Saved identities |
| `POST` | `/me/wallet` | Bearer | identity to save | Wallet item |

### Verify success `data` (typical)

```json
{
  "verificationId": "ver_…",
  "status": "AUTHENTICATED",
  "trustScore": 92,
  "verifiedAt": "…",
  "product": { "id": "prd_…", "name": "…", "sku": "…" },
  "brand": { "id": "brd_…", "name": "…" },
  "manufacturer": { "id": "org_…", "name": "…", "verified": true },
  "batch": { "id": "bat_…", "batchNumber": "…", "expiryDate": null },
  "identity": { "id": "pid_…", "status": "ACTIVE" },
  "signals": [{ "code": "SIGNATURE_VALID", "passed": true }],
  "warnings": [],
  "reasons": [],
  "previousScans": [],
  "guidance": { "title": "…", "body": "…", "severity": "info" },
  "scan": {
    "decodedFromImage": false,
    "kind": "authentic_qr",
    "canonicalCode": "pid_…",
    "checksumValid": true,
    "symbols": []
  },
  "lookup": null
}
```

When `status` is `UNVERIFIED` and `lookup.found` is true, show catalog metadata (title, brand from Open Library / OFF) and clarify it is **not** a unique AUTHENTIC unit.

### Camera scan (frontend)

```ts
const fd = new FormData();
fd.append('image', file); // jpeg/png/webp
fd.append('source', 'CAMERA');
fd.append('platform', 'WEB');

const res = await fetch(`${API}/public/scan`, { method: 'POST', body: fd });
const body = await res.json();
// body.data.status, body.data.scan.symbols, …
```

Do **not** upload huge videos; still images only.

---

## 6. Manufacturer / business dashboard

All routes below need:

```http
Authorization: Bearer <accessToken>
x-organization-id: org_…
```

### 6.1 Organizations

| Method | Path | Notes |
| --- | --- | --- |
| `POST` | `/organizations` | Create workspace; user becomes OWNER |
| `GET` | `/organizations` | List memberships (pick `orgId`) |
| `GET` | `/organizations/:id` | Detail |
| `GET` | `/organizations/members` | Needs org header |
| `POST` | `/organizations/members` | Invite/update member (OWNER/ADMIN) |
| `PATCH` | `/organizations/members/:userId` | Change role (`usr_…`) |
| `DELETE` | `/organizations/members/:userId` | Remove member |
| `POST` | `/organizations/leave` | Leave current org |

### 6.2 Catalog: brand → product → variant → batch

| Method | Path | Body essentials |
| --- | --- | --- |
| `POST` | `/brands` | `{ name, … }` → `{ id: "brd_…" }` |
| `GET` | `/brands` | Paginated `{ items, page, limit, total }` |
| `PATCH`/`DELETE` | `/brands/:id` | Update / archive-delete |
| `POST` | `/products` | `{ brandId, name, sku, category, … }` |
| `GET` | `/products` | Includes `images[]` with `url` |
| `GET` | `/products/:id` | Public product detail |
| `PATCH`/`DELETE` | `/products/:id` | |
| `POST` | `/products/:id/images` | `multipart` file |
| `POST` | `/product-variants` | `{ productId, name, sku }` |
| `PATCH`/`DELETE` | `/product-variants/:id` | |
| `POST` | `/batches` | `{ productId` or variant, `batchNumber`, `manufacturingDate`, `quantity` }` |
| `GET` | `/batches` | |
| `PATCH` | `/batches/:id` | |

**Seamless catalog UX:** after each create, keep the returned `id` in form state for the next step (brand → product → batch → generate).

### 6.3 Identities (mint + print)

| Method | Path | Notes |
| --- | --- | --- |
| `POST` | `/product-identities/generate` | `{ batchId, count }` + optional channels. Send `Idempotency-Key` header |
| `GET` | `/product-identities` | List |
| `POST` | `/product-identities/activate` | |
| `POST` | `/product-identities/revoke` | OWNER/ADMIN |
| `POST` | `/product-identities/credentials` | Attach barcode/ISBN/NFC etc. |
| `GET` | `/product-identities/export?format=csv\|pdf&batchId=` | **Blob** download (JWT + org) |
| `GET` | `/product-identities/:id/label` | **PNG** blob |

Generate `data` example:

```json
{
  "count": 10,
  "identities": [
    {
      "publicId": "pid_…",
      "serialNumber": "…",
      "verifyUrl": "https://…/scan?code=pid_…",
      "labelUrl": "https://…/api/v1/product-identities/pid_…/label"
    }
  ],
  "truncated": false,
  "export": { "csv": "…", "pdf": "…" }
}
```

**Frontend print tip:** export/label URLs need auth — use `fetch` + `blob()` + object URL, not a bare `<a href>` in a new tab without headers.

### 6.4 Analytics & billing

| Method | Path | Query / body |
| --- | --- | --- |
| `GET` | `/analytics/dashboard` | Role-aware cockpit (`meta.sections`); `days`, `from`, `to`, `productId`, `batchId` — see [FRONTEND_DASHBOARDS.md](./FRONTEND_DASHBOARDS.md) |
| `GET` | `/analytics/verifications` | paginated scan history |
| `GET` | `/billing` | plan, usage, remaining quotas, payment mode |
| `POST` | `/billing/subscribe` | `{ planCode, acceptedTermsVersion, callbackUrl? }` |
| `POST` | `/billing/renew` | `{ acceptedTermsVersion }` |
| `GET` | `/public/pricing` | Public plan catalog |
| `GET` | `/public/legal/terms` | Use `version` as `acceptedTermsVersion` |
| `GET` | `/public/billing/config` | `{ provider: "paystack"\|"invoice", enabled, publicKey }` |
| `GET` | `/billing/paystack/verify?reference=` | After Paystack redirect |

Subscribe when Paystack is live:

```json
{
  "planCode": "GROWTH",
  "status": "PAYMENT_PENDING",
  "payment": {
    "provider": "paystack",
    "reference": "pay_…",
    "authorizationUrl": "https://checkout.paystack.com/…"
  }
}
```

Frontend: `window.location = data.payment.authorizationUrl`, then on return call `/billing/paystack/verify?reference=…`.

Dashboard `data` includes: `totalScans`, `verified`, `alerts`, `trend[]`, `recent[]`, `quota`, `plan`.

### 6.5 Recalls, reports, warranties, supply chain

| Area | Endpoints |
| --- | --- |
| Recalls | `POST/GET /recalls` |
| Org reports | `GET /reports` (public create: `POST /reports`) |
| Warranties | `POST /warranties` (consumer), `GET /warranties` (org) |
| Supply chain | `POST/GET /supply-chain/events` |

### 6.6 Files

| Method | Path | Notes |
| --- | --- | --- |
| `POST` | `/files` | multipart `file` + `purpose` (`PRODUCT_IMAGE`, …) → `{ id, url, cdn }` |
| `GET` | `/public/files/:id` | Public image bytes if no CDN URL |

Render `<img src={image.url} />` when `url` is present.

### 6.7 API keys & webhooks (Growth+)

| Method | Path |
| --- | --- |
| `GET/POST/DELETE` | `/api-keys` |
| `GET/POST/PATCH/DELETE` | `/webhooks` |
| `GET` | `/webhooks/:id/deliveries` |
| `POST` | `/webhooks/deliveries/:id/retry` |

Show the API key secret **once** at creation.

---

## 7. Platform admin (AUTHENTIC staff UI)

Requires JWT user with platform role `ADMIN` or `SUPER_ADMIN` (seed: `admin@authentic.local`).

| Method | Path |
| --- | --- |
| `GET` | `/admin/dashboard` | **Fat** admin: growth, revenue, geo, funnel, KYC, health — [FRONTEND_DASHBOARDS.md](./FRONTEND_DASHBOARDS.md) |
| `GET` | `/admin/metrics` | Legacy headline counts only |
| `GET` | `/admin/subscribers` |
| `GET` | `/admin/organizations` |
| `PATCH` | `/admin/organizations/:id` | `{ status: "ACTIVE"\|…, notes? }` KYC |
| `POST` | `/admin/organizations/:id/activate-plan` | `{ planCode }` invoice path |
| `GET` | `/admin/reports` | Shaped list (`id` = `rpt_…`) |
| `PATCH` | `/admin/reports/:id` | `{ status, reviewOutcome? }` triage |
| `PATCH` | `/admin/brands/:id` | brand verification status |

Consumer home: `GET /me/dashboard` · `GET /me/reports` (filed reports).

---

## 8. Pagination, idempotency, rate limits

**Lists:** `?page=1&limit=20` → inside `data`:

```json
{ "items": [], "page": 1, "limit": 20, "total": 42 }
```

**Idempotency:** on generate / activate / create webhook:

```http
Idempotency-Key: <uuid>
```

**Limits:** public ~60/min, JWT ~120/min, API key ~300/min. On `429`, show retry and use `error.code === "RATE_LIMITED"`.

---

## 9. End-to-end product journeys

### A. Consumer verifies a pack

1. User opens `/verify` on Vercel.  
2. Frontend `POST /public/verify` with `{ code }` or `POST /public/scan` with image.  
3. Render `status`, `trustScore`, `guidance`, product/brand cards.  
4. Optional: signed-in user saves via `POST /me/wallet`.  
5. Suspicious pack → `POST /reports`.

Backend is source of truth; frontend only displays.

### B. Manufacturer issues IDs

1. Register with `organizationName` or login + select org.  
2. Store JWT + `orgId`.  
3. Create brand → product → batch.  
4. `POST /product-identities/generate`.  
5. Download PDF/CSV with authenticated blob fetch.  
6. Print QR; consumer hits `verifyUrl` / `/verify`.  
7. Manufacturer watches `GET /analytics/dashboard`.  
8. Subscribe when trial ends (`GET /public/legal/terms` → `POST /billing/subscribe`).

### C. Paystack return

1. Subscribe → redirect to Paystack.  
2. Return URL includes `reference`.  
3. Frontend calls `GET /billing/paystack/verify?reference=…`.  
4. Refresh `GET /billing` for `ACTIVE` plan.

### D. Frontend + backend “seamless” checklist

| Frontend | Backend |
| --- | --- |
| `NEXT_PUBLIC_API_URL` points at live API | `CORS_ORIGINS` includes Vercel origin |
| Sends Bearer + `x-organization-id` on biz routes | Validates membership / scopes |
| Uses envelope `data` / `error` | Always wraps JSON |
| Never invents verification outcome | Computes status + trustScore |
| Uses `verifyUrl` / public product images as returned | `APP_WEB_URL` / R2 public URL configured |
| Handles 401 with refresh | Issues rotating refresh tokens |

---

## 10. Error codes the UI should handle

| Code | UX |
| --- | --- |
| `UNAUTHORIZED` | Re-login / refresh |
| `FORBIDDEN` / `INSUFFICIENT_SCOPE` | Upgrade plan or wrong role |
| `VALIDATION` / `BAD_REQUEST` | Inline field errors from `message` |
| `PLAN_LIMIT` | Upsell / wait for period reset |
| `SUBSCRIPTION_INACTIVE` | Force billing screen |
| `PRODUCT_NOT_FOUND` / `IDENTITY_NOT_FOUND` | Empty state |
| `RATE_LIMITED` | Backoff |
| `PAYMENT_FAILED` | Retry Paystack |

---

## 11. Quick smoke tests from the frontend

```bash
# health
curl https://YOUR-API-HOST/health

# verify demo (after seed) or any pid_
curl -X POST https://YOUR-API-HOST/api/v1/public/verify \
  -H "Content-Type: application/json" \
  -d '{"code":"pid_demoR8K2M19X"}'
```

Swagger: `https://YOUR-API-HOST/docs`

---

## 12. What not to do

- Don’t call Contabo/`localhost` from the browser without a public HTTPS API URL.  
- Don’t hardcode verification “pass/fail” strings that contradict `status`.  
- Don’t put API keys in the Vercel client bundle.  
- Don’t open export/label URLs without the JWT.  
- Don’t skip `x-organization-id` on manufacturer pages.  
- Don’t treat `UNVERIFIED` + catalog lookup as a cryptographic AUTHENTIC hit.

---

## Related docs

- [API.md](../API.md) — partner/API-key contract, webhooks  
- [ARCHITECTURE.md](../ARCHITECTURE.md) — domain model  
- [ENV.md](ENV.md) — keys for Resend, R2, Paystack, CORS  
- [README.md](../README.md) — run / deploy  
