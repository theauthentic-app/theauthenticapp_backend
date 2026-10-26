# AUTHENTIC Backend

Production NestJS API for product identity, verification, and brand protection.

## Stack

NestJS 11 · TypeScript · PostgreSQL · Prisma · Redis · JWT · Swagger

## Local setup

```bash
cd backend
cp .env.example .env
docker compose up -d postgres redis
npm install
npx prisma generate
npx prisma migrate dev --name init
npm run prisma:seed
npm run start:dev
```

API: http://localhost:3001/api/v1  
Health: http://localhost:3001/health and http://localhost:3001/api/v1/health  
Swagger UI: http://localhost:3001/docs  
Manufacturer app: http://localhost:3001/app  
Consumer scan: http://localhost:3001/scan  
OpenAPI JSON: http://localhost:3001/docs-json and `docs/openapi.json`  
Partner guide: [API.md](API.md)  
Environment variables (what each key is and where to get it): [docs/ENV.md](docs/ENV.md)

Paystack is plug-and-play: leave `PAYSTACK_SECRET_KEY` empty for invoice/admin activate. Set the secret + public key and checkout turns on.

```bash
npm run docs:openapi
```

## Demo accounts (seed)

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

# Decode a barcode/QR photo on the server, then verify or look it up worldwide
curl -X POST http://localhost:3001/api/v1/public/scan \
  -F "image=@barcode.jpg" \
  -F "source=CAMERA"
```

Unknown ISBN/GTIN scans return `UNVERIFIED` when a public catalog match is found (Open Library, Google Books, Open Food Facts). That identifies a product *type*, not a unique AUTHENTIC unit.

Mail defaults to `EMAIL_PROVIDER=log` (prints HTML as text). Set `smtp` + SMTP_* for Nodemailer, or `resend` + `RESEND_API_KEY` later. Uploads default to local disk; set `STORAGE_PROVIDER=r2` and the R2 keys when the bucket is ready.

Enterprise routes require `Authorization: Bearer <accessToken>` and `x-organization-id: <organization public id>`.

## Scripts

```bash
npm run start:dev
npm run lint
npm run test
npm run test:e2e   # requires DATABASE_URL
npm run build
```
