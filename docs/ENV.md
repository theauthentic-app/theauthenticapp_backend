# AUTHENTIC environment variables

Copy `.env.example` to `.env` and fill the values below.

Empty `EMAIL_PROVIDER` / `STORAGE_PROVIDER` / `PAYSTACK_SECRET_KEY` is fine. The API auto-detects:

- Resend if `RESEND_API_KEY` is set
- Cloudflare R2 if the R2 keys + bucket are set
- Paystack checkout if `PAYSTACK_SECRET_KEY` is set
- Otherwise mail logs to the console, files stay on disk, and billing uses invoice + admin activate

Check what is live: `GET /health` (`mail`, `storage`, `payments`).

---

## 1. Required to boot

These must be present or the process will not start.

| Variable | Example | How to get it |
| --- | --- | --- |
| `NODE_ENV` | `development` | Use `development` locally, `production` on the server. |
| `PORT` | `3001` | Any free port. Default is `3001`. |
| `DATABASE_URL` | `postgresql://authentic:authentic@localhost:5432/authentic?schema=public` | Postgres connection string. Local Docker: `docker compose up -d postgres`. Hosted: Neon, Supabase, RDS, or Railway → copy the URI. URL-encode special characters in the password (`$` → `%24`). |
| `JWT_ACCESS_SECRET` | 32+ random chars | Generate locally: `node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"` |
| `JWT_REFRESH_SECRET` | 32+ random chars | Same command, **different** value from the access secret. |
| `IDENTITY_SIGNING_SECRET` | 32+ random chars | Same command again. Signs product identity QR payloads. Changing this invalidates existing signatures. |

Minimum local `.env`:

```env
NODE_ENV=development
PORT=3001
DATABASE_URL=postgresql://authentic:authentic@localhost:5432/authentic?schema=public
JWT_ACCESS_SECRET=paste-32-plus-random-chars
JWT_REFRESH_SECRET=paste-a-different-32-plus-random-chars
IDENTITY_SIGNING_SECRET=paste-a-third-32-plus-random-chars
```

Then:

```bash
docker compose up -d postgres redis
npx prisma migrate deploy
npm run start:dev
```

---

## 2. App URLs (set these before you send email or print QR)

| Variable | Example | Why |
| --- | --- | --- |
| `API_BASE_URL` | `http://localhost:3001` | Used in identity export/label links. Production: `https://api.yourdomain.com` |
| `APP_WEB_URL` | `http://localhost:3001` | QR codes open `/scan`, emails open `/app`. Production: your public web origin. |
| `CORS_ORIGINS` | `http://localhost:3000,http://localhost:3001` | Comma-separated browser origins allowed to call the API. Add your real frontend later. |

---

## 3. Redis (strongly recommended)

| Variable | Example | How to get it |
| --- | --- | --- |
| `REDIS_URL` | `redis://localhost:6379` | Local: `docker compose up -d redis`. Hosted: Upstash, Redis Cloud, or Railway. Optional at boot, but rate limits, verify cache, webhook retries, and “send this email once” need it. |

---

## 4. Resend (email)

Leave `EMAIL_PROVIDER` empty. When `RESEND_API_KEY` is set, welcome, verify, reset, member-added, payment, KYC, trial, quota, recall, and risk emails send through Resend.

| Variable | Example | How to get it |
| --- | --- | --- |
| `EMAIL_PROVIDER` | *(empty)* or `resend` | Empty = auto. Set `resend` to force it. `log` prints mail to the server log. `smtp` uses SMTP instead. |
| `RESEND_API_KEY` | `re_...` | 1. Create an account at [resend.com](https://resend.com) 2. **API Keys → Create API Key** 3. Permission: Sending access 4. Paste the `re_` key here |
| `MAIL_FROM` | `AUTHENTIC <noreply@yourdomain.com>` | Resend will reject `@localhost`. Add and verify your domain: Resend → **Domains → Add Domain** → add the DNS records (SPF, DKIM, optionally DMARC) at your DNS host → wait until status is **Verified**. Then use an address on that domain. |

SMTP is only a fallback if you do not want Resend:

| Variable | Notes |
| --- | --- |
| `SMTP_HOST` | e.g. `smtp.gmail.com` or your ESP host |
| `SMTP_PORT` | Usually `587` |
| `SMTP_SECURE` | `true` only for port `465` |
| `SMTP_USER` / `SMTP_PASS` | Provider username and app password |

---

## 5. Cloudflare R2 (images)

Leave `STORAGE_PROVIDER` empty. When the R2 keys + bucket are set, product images upload to R2.

| Variable | Example | How to get it |
| --- | --- | --- |
| `STORAGE_PROVIDER` | *(empty)* or `r2` | Empty = auto. `local` keeps files under `STORAGE_LOCAL_DIR`. |
| `STORAGE_LOCAL_DIR` | `./storage` | Local disk folder when R2 is not configured. |
| `R2_ACCOUNT_ID` | `a1b2c3...` | Cloudflare dashboard → right sidebar **Account ID**, or **R2 → Overview**. |
| `R2_ACCESS_KEY_ID` | `...` | Cloudflare → **R2 → Manage API tokens → Create API token**. Use Object Read & Write on the bucket (or the whole account). Copy **Access Key ID**. |
| `R2_SECRET_ACCESS_KEY` | `...` | Shown **once** on that same token screen. Copy **Secret Access Key**. |
| `R2_BUCKET` | `authentic-images` | **R2 → Create bucket**. Name it, region usually Automatic. |
| `R2_ENDPOINT` | *(leave empty)* | Auto: `https://<R2_ACCOUNT_ID>.r2.cloudflarestorage.com`. Only set this if Cloudflare gives you a custom S3 endpoint. |
| `R2_REGION` | `auto` | Keep `auto`. |
| `R2_PUBLIC_BASE_URL` | `https://images.yourdomain.com` | Needed so the API can return a public image URL. Two options below. |

### Make the bucket public (pick one)

**Option A — r2.dev (fastest to test)**

1. Open the bucket → **Settings → Public development URL**
2. Enable it
3. Copy `https://pub-xxxxx.r2.dev`
4. Set `R2_PUBLIC_BASE_URL=https://pub-xxxxx.r2.dev` (no trailing slash)

**Option B — custom domain (production)**

1. Bucket → **Settings → Custom Domains** → add `images.yourdomain.com`
2. Create the CNAME Cloudflare shows
3. Set `R2_PUBLIC_BASE_URL=https://images.yourdomain.com`

Until `R2_PUBLIC_BASE_URL` is set, product images still upload, and the API falls back to `GET /api/v1/public/files/:id`.

---

## 6. Paystack (card checkout)

Leave empty until you have keys. Empty = invoice + `POST /admin/organizations/:id/activate-plan`.

| Variable | How to get it |
| --- | --- |
| `PAYSTACK_SECRET_KEY` | [dashboard.paystack.com](https://dashboard.paystack.com) → **Settings → API Keys & Webhooks**. Use **test** keys locally (`sk_test_...`). Live keys start with `sk_live_`. |
| `PAYSTACK_PUBLIC_KEY` | Same page (`pk_test_...` / `pk_live_...`). Returned by `GET /public/billing/config` for the browser. |

Webhook URL to paste in Paystack:

`https://your-api-host/api/v1/billing/paystack/webhook`

Local testing: [Paystack CLI](https://paystack.com/docs/tools/cli) or a tunnel (ngrok / Cloudflare Tunnel) pointing at `localhost:3001`.

---

## 7. Optional product

| Variable | Default | What it does |
| --- | --- | --- |
| `ORG_KYC_REQUIRED` | `false` | `true` = new manufacturers stay `PENDING` until an admin approves them (`PATCH /admin/organizations/:id`). |
| `SWAGGER_ENABLED` | `true` | Set `false` to hide `/docs` in production. |
| `THROTTLE_PUBLIC` | `60` | Requests / minute for unauthenticated routes. |
| `THROTTLE_JWT` | `120` | Requests / minute for signed-in users. |
| `THROTTLE_API_KEY` | `300` | Requests / minute for partner API keys. |
| `GOOGLE_BOOKS_API_KEY` | empty | Optional ISBN fallback. [Google Cloud Console](https://console.cloud.google.com/) → enable **Books API** → create an API key. Open Library still works without this. |
| `CATALOG_LOOKUP_UPCITEMDB` | `false` | Set `true` to also query UPCitemdb for barcodes. Rate-limited; leave false unless you need it. |
| `SMS_PROVIDER` | `log` | Placeholder. SMS is not sending yet; keep `log`. |

Aliases you can ignore unless you already use them: `STORAGE_BUCKET` (same as `R2_BUCKET`), `STORAGE_PUBLIC_BASE_URL` (same as `R2_PUBLIC_BASE_URL`).

---

## 8. Launch checklist

**Local (no paid accounts)**

- Required secrets + local Postgres
- Redis via Docker
- Mail logs, local disk storage, invoice billing

**Pilot / public SaaS**

1. Hosted Postgres + Redis
2. Strong unique JWT + identity secrets (not the Docker defaults)
3. `API_BASE_URL` and `APP_WEB_URL` on HTTPS
4. Resend domain verified + `RESEND_API_KEY` + `MAIL_FROM`
5. R2 bucket + API token + `R2_PUBLIC_BASE_URL`
6. Paystack test keys, then live keys
7. `ORG_KYC_REQUIRED=true` if you want to approve manufacturers first
8. `SWAGGER_ENABLED=false` if you do not want public docs
9. Confirm `GET /health` shows `mail.ready`, `storage.ready`, and `payments.ready`

---

## 9. Full template

```env
NODE_ENV=development
PORT=3001
API_BASE_URL=http://localhost:3001
APP_WEB_URL=http://localhost:3001
CORS_ORIGINS=http://localhost:3000,http://localhost:3001

DATABASE_URL=postgresql://authentic:authentic@localhost:5432/authentic?schema=public
REDIS_URL=redis://localhost:6379

JWT_ACCESS_SECRET=
JWT_REFRESH_SECRET=
JWT_ACCESS_TTL=8h
JWT_REFRESH_TTL=14d
IDENTITY_SIGNING_SECRET=

# Resend — leave EMAIL_PROVIDER empty
EMAIL_PROVIDER=
RESEND_API_KEY=
MAIL_FROM=AUTHENTIC <noreply@yourdomain.com>

# Cloudflare R2 — leave STORAGE_PROVIDER empty
STORAGE_PROVIDER=
STORAGE_LOCAL_DIR=./storage
R2_ACCOUNT_ID=
R2_ACCESS_KEY_ID=
R2_SECRET_ACCESS_KEY=
R2_BUCKET=
R2_ENDPOINT=
R2_REGION=auto
R2_PUBLIC_BASE_URL=

PAYSTACK_SECRET_KEY=
PAYSTACK_PUBLIC_KEY=

ORG_KYC_REQUIRED=false
SWAGGER_ENABLED=true
THROTTLE_PUBLIC=60
THROTTLE_JWT=120
THROTTLE_API_KEY=300

GOOGLE_BOOKS_API_KEY=
CATALOG_LOOKUP_UPCITEMDB=false
SMS_PROVIDER=log
```

Never commit `.env`. Rotate any key that was pasted into chat, email, or a ticket.
