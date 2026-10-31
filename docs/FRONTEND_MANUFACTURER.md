# Frontend: manufacturer cockpit (all product modules)

Hand this to the manufacturer UI agent. Auth + org header required:

```http
Authorization: Bearer <accessToken>
x-organization-id: org_…
```

Base: `{API_BASE}/api/v1`  
Envelope: `{ success, data }` — see [FRONTEND_AUTH.md](./FRONTEND_AUTH.md).

Related: [FRONTEND_DASHBOARDS.md](./FRONTEND_DASHBOARDS.md) · [PARTNER_API.md](./PARTNER_API.md) · Swagger `/docs`

---

## 1. Home = one dashboard, ten modules

`GET /analytics/dashboard?days=30`

`data.modules[]` is the **nav + KPI source of truth**. Do not invent module counts client-side.

Each module:

```ts
{
  key: "products" | "batches" | "verifications" | "riskSignals" | "counterfeitIntel"
     | "supplyChain" | "recalls" | "warranties" | "analytics" | "apiAccess",
  title: string,
  href: string,           // suggested app route
  api: Record<string, string>,
  kpis: Record<string, number | string | null>,
  status: "ok" | "watch" | "alert",
  blurb: string,
  locked?: boolean        // e.g. API Access on Starter
}
```

### UI pattern

```
┌─────────────────────────────────────────────────────┐
│ Workspace · role · date range                        │
│ Hero KPIs from data.summary / protection.kpis        │
│ Alert rail from protection.alerts                    │
├─────────────────────────────────────────────────────┤
│ Module grid (10 tiles) — color by module.status      │
│ click → route module.href                            │
├─────────────────────────────────────────────────────┤
│ Role sections: insights / operations / finance / team│
└─────────────────────────────────────────────────────┘
```

Hide finance/team/insights/ops using `meta.sections` (see dashboards doc).

---

## 2. Module → endpoints map

| Module | Primary reads | Writes |
| --- | --- | --- |
| **Products** | `GET /products`, `GET /products/:id`, `GET /brands` | `POST/PATCH/DELETE /products`, brands, variants, images |
| **Batches** | `GET /batches` | `POST/PATCH /batches` |
| **Verifications** | `GET /analytics/verifications`, dashboard trend | Public: `POST /public/verify`, `POST /public/scan` |
| **Risk Signals** | `GET /risk-signals?severity=&type=&page=` | (system-generated) |
| **Counterfeit Intel** | `GET /intel/counterfeit?days=30` | Triage via `GET/PATCH` reports (admin/org) |
| **Supply Chain** | `GET /supply-chain/events` | `POST /supply-chain/events` |
| **Recall Center** | `GET /recalls` | `POST /recalls` |
| **Warranties** | `GET /warranties` | Consumer `POST /warranties` |
| **Analytics** | `GET /analytics/dashboard` | — |
| **API Access** | `GET /api-keys`, `GET /webhooks` | `POST/DELETE` keys, webhooks (Growth+) |

### Identities (cross-cutting)

Mint/print lives under identities but powers Products/Batches:

- `POST /product-identities/generate`
- `GET /product-identities`, export, label, activate, revoke

---

## 3. Screen contracts

### Products / Batches / Catalog

Use existing catalog APIs in [FRONTEND.md](./FRONTEND.md) §6.2. After create, keep returned `id` for the next step (brand → product → variant → batch → generate).

### Verifications

- Table: `GET /analytics/verifications?page=&limit=`
- Never show “fake/original” — map `status` enum to evidence copy.

### Risk Signals

`GET /risk-signals`

```ts
{ items: Array<{
  id, type, severity, scoreImpact, evidence, detectedAt,
  identityId, verificationId, verificationStatus
}>, page, limit, total }
```

Filter chips: `DUPLICATE_CREDENTIAL`, `IMPOSSIBLE_TRAVEL`, `HIGH_SCAN_FREQUENCY`, …

### Counterfeit Intel

`GET /intel/counterfeit?days=30`

```ts
{
  meta: { disclaimer, range },
  summary: { counterfeitReports, openCounterfeit, compromisedScans, suspiciousScans, cloneSignals, heatScore },
  geo: { cities },
  recentReports, recentRiskScans,
  suggestedActions
}
```

**Copy rule:** always surface `meta.disclaimer` — evidence, not legal verdict.

### Supply Chain / Recalls / Warranties

List + create as in FRONTEND.md §6.5. Recall create needs `severity`, `startDate`, optional `batchIds`.

### API Access

If `modules` tile has `locked: true`, show upgrade CTA → billing. Else list keys/webhooks; show secret **once** on create.

---

## 4. Platform admin extras (not manufacturer)

| Feature | API |
| --- | --- |
| Ban user | `PATCH /admin/users/:id/status` `{ status: "SUSPENDED", reason? }` |
| Unban | `{ status: "ACTIVE" }` |
| Search users | `GET /admin/users?q=` |
| Blog CMS | `GET/POST/PATCH/DELETE /admin/blog` |
| Public blog | `GET /public/blog`, `GET /public/blog/:slug` |

Banned users get `ACCOUNT_BANNED` on login; JWT validate fails mid-session.

---

## 5. SEO blog (marketing site)

Public list/detail for Next.js blog routes. Admin CMS for drafts → `PUBLISHED`.

Fields: `slug`, `title`, `excerpt`, `bodyMarkdown`, `coverImageUrl`, `seoTitle`, `seoDescription`, `tags[]`, `status`.

---

## 6. Checklist

- [ ] Home tiles bound to `data.modules` only
- [ ] Status colors: ok / watch / alert
- [ ] Counterfeit disclaimer visible
- [ ] Risk + intel pages wired
- [ ] API Access respects `locked` + plan
- [ ] Role sections still gated
- [ ] Swagger `/docs` for partner handoff
