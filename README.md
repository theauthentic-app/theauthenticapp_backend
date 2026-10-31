# AUTHENTIC Backend

Product identity and brand-protection API. Manufacturers register products, mint signed unit identities (QR / serial / barcode / NFC / RFID), and consumers verify them. Partners integrate with JWT or API keys.

This is a NestJS modular monolith — one deployable API with clear domain modules, not a white-label kit.

| | |
| --- | --- |
| **Runtime** | NestJS 11 · Node 22 · TypeScript |
| **Data** | PostgreSQL (Prisma 6) · Redis |
| **Auth** | JWT (human) · API keys `atk_live_…` (partners) |
| **Docs** | Swagger `/docs` · OpenAPI `docs/openapi.json` |
| **Mail** | Resend (auto) · SMTP · or log |
| **Images** | Cloudflare R2 (auto) · or local disk |
| **Payments** | Paystack checkout · or invoice + admin activate |

---

## What this API does

1. **Manufacturer onboarding** — register, org + trial plan, optional KYC gate  
2. **Catalog** — brands → products → variants → batches  
3. **Identity minting** — bulk signed units with printable QR / CSV / PDF packs  
4. **Consumer verification** — scan QR/barcode (text or image); evidence-based status (`AUTHENTICATED`, `SUSPICIOUS`, `COMPROMISED`, … — never “original/fake”)  
5. **Brand ops** — recalls, reports, warranties, supply-chain events, analytics  
6. **Partner edge** — API keys, scopes, signed webhooks with retry worker  
7. **Billing** — Starter / Growth / Enterprise (NGN), Paystack or invoice  

---

## Quick start (local)

**Requirements:** Node 22+, Docker (Postgres + Redis), or hosted Neon + Redis.

```bash
git clone https://github.com/theauthentic-app/theauthenticapp_backend.git
cd theauthenticapp_backend
cp .env.example .env
# set JWT_ACCESS_SECRET, JWT_REFRESH_SECRET, IDENTITY_SIGNING_SECRET (32+ chars each)

docker compose up -d postgres redis
npm ci
npx prisma generate
npx prisma migrate deploy
npm run prisma:seed
npm run start:dev
```

| Surface | URL |
| --- | --- |
| API base | http://localhost:3001/api/v1 |
| Health | http://localhost:3001/health |
| Swagger | http://localhost:3001/docs |
| Manufacturer UI | http://localhost:3001/app |
| Consumer scan | http://localhost:3001/scan |

Generate secrets:

```bash
node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"
```

Full env reference (Resend, R2, Paystack, Contabo): **[docs/ENV.md](docs/ENV.md)**

---

## Demo accounts (after seed)

| Role | Email | Password |
| --- | --- | --- |
| Platform admin | `admin@authentic.local` | `authentic-demo` |
| Manufacturer | `ada@aurelia.local` | `authentic-demo` |
| Consumer | `ibrahim@authentic.local` | `authentic-demo` |

Demo identity: `pid_demoR8K2M19X`

```bash
curl -X POST http://localhost:3001/api/v1/public/verify \
  -H "Content-Type: application/json" \
  -d "{\"code\":\"pid_demoR8K2M19X\"}"

curl -X POST http://localhost:3001/api/v1/public/scan \
  -F "image=@barcode.jpg" \
  -F "source=CAMERA"
```

---

## Domain model

```
Organization → Brand → Product → Variant → Batch → ProductIdentity → Credential
                                                              ↓
                                                      Verification → RiskSignal
```

Public IDs use prefixes (`usr_`, `org_`, `pid_`, …). The server owns verification status and trust score; clients cannot set them.

---

## Authentication

| Caller | Headers | Authorization |
| --- | --- | --- |
| Dashboard user | `Authorization: Bearer <jwt>` + `x-organization-id: <org public id>` | Org role (OWNER, ADMIN, …) |
| Partner integration | `X-API-Key: atk_live_…` (or Bearer) | API key scopes |

**Scopes:** `PRODUCT_READ` · `PRODUCT_WRITE` · `VERIFY` · `ANALYTICS_READ` · `WEBHOOKS`  
API keys require Growth/Enterprise. Admin routes are human-only.

Response envelope:

```json
{
  "success": true,
  "data": {},
  "timestamp": "…",
  "requestId": "…"
}
```

Partner contract: **[API.md](API.md)** · Frontend integration: **[docs/FRONTEND.md](docs/FRONTEND.md)** · Blockchain + mail for FE: **[docs/FRONTEND_BLOCKCHAIN.md](docs/FRONTEND_BLOCKCHAIN.md)** · Architecture: **[ARCHITECTURE.md](ARCHITECTURE.md)**

---

## Core flows

### Manufacturer happy path

1. `POST /auth/register` (optional `organizationName`) → trial starts  
2. Create brand → product → batch  
3. `POST /product-identities/generate` → QR links, CSV/PDF export  
4. Consumer opens `/scan?code=<pid_…>` or `POST /public/verify`  
5. Subscribe via `POST /billing/subscribe` (Paystack URL or invoice)  

### Verification pipeline

1. Optional image decode (ZXing; image not stored)  
2. Normalize code → hash lookup on credentials  
3. Validate HMAC signature, recalls, clones, travel risk  
4. Persist verification + optional risk signals  
5. Fire webhooks (`verification.created`, `risk.detected`)  
6. If unknown ISBN/GTIN → public catalog lookup (`UNVERIFIED` product *type*, not AUTHENTIC unit)  

### Billing

| Mode | When |
| --- | --- |
| Paystack | `PAYSTACK_SECRET_KEY` set → checkout URL returned |
| Invoice | Keys empty → `INVOICE_PENDING` + admin `POST /admin/organizations/:id/activate-plan` |

Also: `POST /billing/renew`, hourly expiry/trial emails, `GET /admin/subscribers`.

---

## Modules

| Area | Responsibility |
| --- | --- |
| `auth` | Register, login, refresh, verify email, reset password |
| `organizations` | Multi-tenant membership + RBAC |
| `products` | Brands, products, variants, batches, images |
| `product-identities` | Mint / activate / revoke + print exports |
| `verification` | Public + enterprise verify, barcode scan |
| `analytics` | Dashboard metrics, trends, quotas |
| `billing` | Plans, Paystack, renew, cron reconcile |
| `api-keys` / `webhooks` | Partner keys + signed delivery worker |
| `recalls` / `reports` / `warranties` / `supply-chain` | Lifecycle ops |
| `admin` | KYC, metrics, subscribers, plan activate |
| `files` / `mail` / `notifications` | R2/local storage, Resend/SMTP, org alerts |
| `health` | DB, Redis, mail, storage, payments readiness |

---

## Integrations (auto-detect)

Leave `EMAIL_PROVIDER` / `STORAGE_PROVIDER` empty:

| Service | Turn on by setting | Notes |
| --- | --- | --- |
| **Resend** | `RESEND_API_KEY` + verified `MAIL_FROM` | Welcome, KYC, payment, trial, quota, recall, risk |
| **Cloudflare R2** | `R2_ACCOUNT_ID`, access keys, `R2_BUCKET`, `R2_PUBLIC_BASE_URL` | Use `pub-….r2.dev` or custom domain — **not** the S3 API host |
| **Paystack** | `PAYSTACK_SECRET_KEY` + `PAYSTACK_PUBLIC_KEY` | Webhook: `/api/v1/billing/paystack/webhook` |
| **Redis** | `REDIS_URL` | Rate limits, verify cache, email de-dupe, webhook retries |

Check: `GET /health` → `mail.ready`, `storage.ready`, `payments.ready`.

---

## Scripts

```bash
npm run start:dev      # watch mode
npm run build          # compile to dist/
npm run start:prod     # node dist/src/main
npx prisma migrate deploy
npm run prisma:seed
npm run docs:openapi   # refresh docs/openapi.json
npm run lint
npm test
npm run test:e2e       # needs DATABASE_URL
```

After `npm run build`, ensure mail templates are present (Nest asset copy):

```bash
mkdir -p dist/src/mail/templates && cp -r src/mail/templates/* dist/src/mail/templates/
```

---

## Production deploy (Contabo / Ubuntu)

Works alongside another app: run AUTHENTIC on **port 3001**, proxy a subdomain through existing Nginx.

```bash
# on VPS
sudo mkdir -p /var/www/authentic-api && sudo chown $USER:$USER /var/www/authentic-api
cd /var/www/authentic-api
git clone https://github.com/theauthentic-app/theauthenticapp_backend.git .

# install Node 22 + Redis if needed, then:
cp .env.example .env   # edit production values — see docs/ENV.md
npm ci
npx prisma generate
npx prisma migrate deploy
npm run build
mkdir -p dist/src/mail/templates && cp -r src/mail/templates/* dist/src/mail/templates/

pm2 start npm --name authentic-api -- run start:prod
pm2 save && pm2 startup
curl http://127.0.0.1:3001/health
```

Nginx (example):

```nginx
server {
  listen 80;
  server_name api.yourdomain.com;
  location / {
    proxy_pass http://127.0.0.1:3001;
    proxy_http_version 1.1;
    proxy_set_header Host $host;
    proxy_set_header X-Forwarded-For $remote_addr;
    proxy_set_header X-Forwarded-Proto $scheme;
  }
}
```

```bash
sudo certbot --nginx -d api.yourdomain.com
```

**Production `.env` must set:** `NODE_ENV=production`, public `API_BASE_URL` / `APP_WEB_URL`, real `CORS_ORIGINS`, strong JWT + identity secrets, Neon (or Postgres) `DATABASE_URL`, Redis on the box or managed.

Docker alternative: `docker compose up -d` (includes Postgres, Redis, and the API image).

---

## Security notes

- Never commit `.env` (also ignore `.env.*` except `.env.example`)  
- Rotate any secret that was pasted into chat, tickets, or screenshots  
- Changing `IDENTITY_SIGNING_SECRET` invalidates existing unit signatures  
- Verification statuses are evidence-based; do not map them to “fake/original” in product copy  
- Webhook URLs are SSRF-checked in production  

More: **[SECURITY.md](SECURITY.md)** · Database: **[DATABASE.md](DATABASE.md)**

---

## Repo layout

```
src/
  auth, organizations, products, product-identities, verification
  billing, analytics, api-keys, webhooks, admin, …
  mail/templates/          # Handlebars emails
  common/                  # guards, envelope, throttling
prisma/                    # schema + migrations + seed
public/app, public/scan    # lightweight manufacturer + consumer UIs
docs/ENV.md, docs/openapi.json
```

---

## Status

MVP-ready for pilot manufacturers: catalog → mint → print → verify → billing → analytics → partner keys.

Still stubs / later: AI packaging risk provider (noop), SMS delivery, polished first-party apps (use `/app` and `/scan` or your own frontend).

---

## License

UNLICENSED — private AUTHENTIC product.
