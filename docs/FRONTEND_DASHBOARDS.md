# Frontend: high-end dashboards (manufacturer · consumer · platform admin)

Feed this to the frontend / design agent. Backend returns **role-aware, chart-ready payloads** with business alerts and suggested actions. Build sleek UX that **corroborates** the data — do not invent KPIs client-side.

Base: `{API_BASE}/api/v1`  
Envelope: `{ success, data, timestamp, requestId }`

---

## 0. Design principles (sleek + dope)

1. **One hero composition per home** — not a wall of cards. First viewport: brand/audience title, one primary metric, one sparkline or trend strip, one alert rail.
2. **Role-driven chrome** — hide sections the API omitted (`meta.sections` / audience). Never show empty “Finance” to a VIEWER.
3. **Alerts drive action** — `alerts[]` + `suggestedActions[]` are first-class UI, not toast spam.
4. **Charts only from series** — `trend`, `growth.*`, `revenue.daily`, `timeline` are the only chart inputs.
5. **Honest language** — product verify statuses are evidence (`AUTHENTICATED`, `SUSPICIOUS`…), never “original/fake.” Consumer `trustScore` is personal history mix, not a product verdict (use the `facts[].hint`).
6. **Motion** — subtle number count-up on KPIs, alert rail slide-in, chart draw once. No purple glow soup.

### Shared visual kit

| Token | Use |
| --- | --- |
| `--ink` | Primary text |
| `--muted` | Secondary |
| `--ok` | AUTHENTICATED / growth up |
| `--warn` | SUSPICIOUS / quota low |
| `--danger` | COMPROMISED / RECALLED / critical alerts |
| `--surface` | Soft panels (prefer gradient/atmosphere over flat cards) |

Severity → color: `info` muted · `warning` warn · `critical` danger.

---

## 1. Manufacturer / org dashboard

Full module map (Products → API Access): **[FRONTEND_MANUFACTURER.md](./FRONTEND_MANUFACTURER.md)**.

`GET /analytics/dashboard` also returns `modules[]` (ten cockpit tiles with KPIs + `status` + API hints).

`GET /analytics/dashboard`

**Auth:** Bearer + `x-organization-id: org_…`  
**Roles:** OWNER, ADMIN, MANAGER, ANALYST, STAFF, VIEWER (and API keys with `ANALYTICS_READ`)

### Query

| Param | Default | Notes |
| --- | --- | --- |
| `days` | `30` | 1–365 |
| `from` / `to` | — | ISO; overrides days |
| `productId` | — | `prd_…` filter |
| `batchId` | — | batch public id |

### Role → sections (backend gated)

| Role | `protection` | `insights` | `operations` | `finance` | `team` |
| --- | --- | --- | --- | --- | --- |
| VIEWER | ✓ | | | | |
| ANALYST | ✓ | ✓ | | | |
| STAFF | ✓ | | ✓ | | |
| MANAGER | ✓ | ✓ | ✓ | | |
| ADMIN | ✓ | ✓ | ✓ | ✓ | ✓ |
| OWNER | ✓ | ✓ | ✓ | ✓ | ✓ |

API keys get ADMIN-equivalent sections; `meta.role` = `"API_KEY"`.

### `data` shape (conceptual)

```ts
{
  meta: {
    audience: "manufacturer",
    role: "OWNER" | "ADMIN" | "MANAGER" | "ANALYST" | "STAFF" | "VIEWER" | "API_KEY",
    sections: { protection, insights, operations, finance, team },
    range: { from, to },
    previousRange: { from, to },
    generatedAt: string
  },
  summary: {
    products, units, active, reportsOpen, totalScans, scansToday,
    verified, suspicious, alerts, activeRecalls,
    plan: { code, name, status }
  },
  protection: {
    kpis: {
      totalScans, scansToday, verified, suspicious, alerts,
      authenticRate, riskRate, scanGrowthPct
    },
    statusBreakdown: Record<VerificationStatus, number>,
    trend: Array<{ day, scans, alerts }>,
    recent: Array<{ id, status, city, country, createdAt, unit }>,
    alerts: Array<{ severity, code, title, detail }>
  },
  insights?: {
    funnel: {
      identitiesIssued, identitiesActive, scansInRange,
      authenticated, flagged, conversionToScan, authenticationRate
    },
    geo: { cities: Record<string, number>, countries: Record<string, number> },
    topProducts: Array<{ productId, name, scans, alerts }>,
    sources: Record<string, number>
  },
  operations?: {
    openReports, openReportsPreview[], activeRecalls, pendingIdentities,
    failedWebhooks, quota, usage
  },
  finance?: { plan, payment, quota, usage },
  team?: { memberCount, byRole: Record<string, number> },
  suggestedActions: Array<{ code, label, href }>
}
```

### UI layout (manufacturer)

```
┌─────────────────────────────────────────────────────────┐
│  Workspace name · role chip · date range picker         │
│  Hero KPI: totalScans (+ scanGrowthPct)  | sparkline    │
│  Alert rail (protection.alerts)                          │
├──────────────┬──────────────────────┬───────────────────┤
│ Status mix   │ Trend (scans/alerts) │ Suggested actions │
│ (donut)      │ (area/line)          │ (from API hrefs)  │
├──────────────┴──────────────────────┴───────────────────┤
│ [if insights] Funnel strip · Geo bars · Top products    │
│ [if operations] Open reports table · Recalls · Quota    │
│ [if finance] Plan + payment CTA · usage meters          │
│ [if team] Role distribution                              │
│ Recent scans list                                        │
└─────────────────────────────────────────────────────────┘
```

**VIEWER:** hero + status + trend + recent only.  
**ANALYST:** + funnel/geo/top products; no billing.  
**STAFF:** + ops queue; no deep insights/finance.  
**OWNER/ADMIN:** full cockpit.

Wire filters: changing product/batch/range re-fetches the same endpoint.

---

## 2. Consumer dashboard

`GET /me/dashboard?days=30`

**Auth:** Bearer (human). No org header.

### `data` shape

```ts
{
  meta: { audience: "consumer", range: { from, to, days }, generatedAt },
  summary: {
    totalScans, scansInRange, authenticated, suspicious, compromised,
    recalled, revoked, notFound, alertScans,
    walletCount, walletAtRisk, reportsFiled, reportsOpen, warranties,
    trustScore: number | null
  },
  facts: Array<{ code, label, value, hint? }>,
  alerts: Array<{ severity, code, title, detail }>,
  timeline: Array<{ day, scans }>,
  brands: Array<{ name, scans }>,
  recentScans: Array<{ id, status, createdAt, city, country, unit }>,
  wallet: {
    items: Array<{ id, savedAt, atRisk, unit }>,
    atRisk: /* subset */
  },
  recalls: Array<{ publicId, recallNumber, reason, severity, instructions }>,
  suggestedActions: Array<{ code, label, href }>
}
```

### UI layout (consumer)

```
┌──────────────────────────────────────────────┐
│  “Your AUTHENTIC”                            │
│  Hero: trustScore or totalScans + timeline   │
│  Alert rail (recalls / wallet at risk)       │
├─────────────────┬────────────────────────────┤
│ Facts strip     │ Suggested actions          │
│ (horizontal)    │ Scan · Wallet · Reports    │
├─────────────────┴────────────────────────────┤
│ Brands you’ve checked (pills / bars)         │
│ Recent scans                                 │
│ Wallet grid — atRisk items elevated          │
│ Active recalls affecting wallet (if any)     │
└──────────────────────────────────────────────┘
```

Empty state: if `totalScans === 0`, full-bleed CTA to `/scan` using `suggestedActions` FIRST_SCAN.

Still use `GET /me/history` and `GET /me/wallet` for dedicated pages; dashboard is the **home aggregate**.

---

## 3. Platform admin dashboard

`GET /admin/dashboard?days=30&from=&to=`

**Auth:** Bearer + platform role `ADMIN` or `SUPER_ADMIN`.

Legacy `GET /admin/metrics` remains (headline counts only) — **prefer dashboard**.

### `data` shape

```ts
{
  meta: { audience: "platform_admin", range, previousRange, generatedAt },
  summary: {
    users, usersInRange, userGrowthPct,
    organizations, orgsInRange, orgGrowthPct,
    identities, verificationsInRange, verificationGrowthPct,
    reportsInRange, reportsOpen,
    orgsPending, orgsActive, orgsSuspended, lockedUsers, subscribersActive,
    revenueKobo, revenueNgn, revenueGrowthPct,
    mrrEstimateKobo, mrrEstimateNgn,
    successfulPayments, failedPayments
  },
  growth: {
    users: Array<{ day, count }>,
    organizations: Array<{ day, count }>,
    scans: Array<{ day, scans, alerts }>
  },
  revenue: {
    totalKobo, totalNgn, currency, growthPct,
    mrrEstimateKobo, mrrEstimateNgn,
    daily: Array<{ day, amountKobo, amountNgn, count }>,
    byPlan: Array<{ planCode, count, amountKobo, amountNgn, listPriceNgn }>,
    recent: /* payments */,
    planMix: Array<{ planCode, status, count }>
  },
  geo: { countries: Record<string, number>, cities: Record<string, number> },
  funnel: {
    registeredUsers, emailVerifiedUsers, usersInOrganization,
    activeOrTrialSubscribers, orgsWithScansInRange,
    rates: { emailVerifyRate, orgAttachRate, subscriberRate }
  },
  scanMix: { byStatus, authenticated, risk },
  kyc: { pending, active, suspended, recent[] },
  reports: { open, inRange, byReason, recent[] },
  health: { failedWebhooks, lockedUsers, failedPayments },
  alerts: [],
  suggestedActions: []
}
```

### UI layout (admin)

```
┌──────────────────────────────────────────────────────────┐
│  AUTHENTIC Control · range picker                        │
│  KPI row: users · orgs · scans · revenueNgn · MRR        │
│  Alert rail (KYC backlog, revenue drop, …)               │
├────────────────────────┬─────────────────────────────────┤
│ Growth multi-series    │ Revenue daily + byPlan          │
│ (users/orgs/scans)     │                                 │
├────────────────────────┼─────────────────────────────────┤
│ Acquisition funnel     │ Geo (countries / cities)        │
├────────────────────────┴─────────────────────────────────┤
│ KYC queue · Reports triage · Recent payments · Health   │
│ Suggested actions → /admin/organizations?status=PENDING  │
└──────────────────────────────────────────────────────────┘
```

Money: display **NGN** from `*Ngn` fields; keep kobo for exact math.

Existing admin mutations stay:

- `PATCH /admin/organizations/:id`
- `POST /admin/organizations/:id/activate-plan`
- `GET /admin/subscribers`
- `GET /admin/reports` (public ids)
- `PATCH /admin/reports/:id` `{ status, reviewOutcome? }`
- `PATCH /admin/brands/:id`

Consumer: `GET /me/reports` for personal report status.

---

## 4. Routing map

| App | Route | API |
| --- | --- | --- |
| Manufacturer | `/app` or `/dashboard` | `GET /analytics/dashboard` |
| Consumer | `/` or `/home` | `GET /me/dashboard` |
| Platform admin | `/admin` | `GET /admin/dashboard` |

On login:

```
if platformRole in ADMIN|SUPER_ADMIN → /admin
else if organizations.length → /app (set x-organization-id)
else → consumer /home
```

---

## 5. Fetch helpers

```ts
async function manufacturerDashboard(api: string, token: string, orgId: string, q: URLSearchParams) {
  const res = await fetch(`${api}/analytics/dashboard?${q}`, {
    headers: {
      Authorization: `Bearer ${token}`,
      'x-organization-id': orgId,
    },
  });
  const json = await res.json();
  if (!json.success) throw json.error;
  return json.data;
}

async function consumerDashboard(api: string, token: string, days = 30) {
  const res = await fetch(`${api}/me/dashboard?days=${days}`, {
    headers: { Authorization: `Bearer ${token}` },
  });
  const json = await res.json();
  if (!json.success) throw json.error;
  return json.data;
}

async function adminDashboard(api: string, token: string, q: URLSearchParams) {
  const res = await fetch(`${api}/admin/dashboard?${q}`, {
    headers: { Authorization: `Bearer ${token}` },
  });
  const json = await res.json();
  if (!json.success) throw json.error;
  return json.data;
}
```

Render sections with:

```ts
if (data.meta.sections?.finance) { /* finance panel */ }
if (data.insights) { /* charts */ }
```

---

## 6. Business logic the UI must respect

| Signal | Meaning | UI |
| --- | --- | --- |
| `authenticRate` / `riskRate` | Share of scans in range | Don’t label as “% real products” |
| `scanGrowthPct` / `*GrowthPct` | vs previous equal window | Green/red delta |
| Org `BILLING_*` alerts | Trial / past due | Soft gate minting CTAs |
| `VERIFY_QUOTA_*` | Quota pressure | Upsell / billing |
| Consumer `trustScore` | Personal scan mix | Tooltip with `facts` hint |
| `wallet.atRisk` | Identity status bad | Pin to top of wallet |
| Admin `funnel.rates` | Platform conversion | Funnel chart steps |
| Admin `mrrEstimateNgn` | Active paid plans × list price | Label as estimate |

---

## 7. Checklist

- [ ] Manufacturer home reads `meta.sections` and hides finance/team/insights/ops correctly per role
- [ ] Date range + product/batch filters wired
- [ ] Charts bind only to API series
- [ ] Alert rail + suggestedActions clickable
- [ ] Consumer home: facts, wallet risk, recalls, timeline
- [ ] Admin: growth + revenue + geo + funnel + KYC
- [ ] Money shown in NGN; kobo kept for precision
- [ ] Empty / loading / error skeletons
- [ ] No client-side fake KPIs

---

## 8. Related docs

- [FRONTEND_AUTH.md](./FRONTEND_AUTH.md) — session before dashboards  
- [FRONTEND.md](./FRONTEND.md) — catalog, identities, billing mutations  
- [FRONTEND_EMAIL_VERIFICATION.md](./FRONTEND_EMAIL_VERIFICATION.md)  
- [FRONTEND_BLOCKCHAIN.md](./FRONTEND_BLOCKCHAIN.md)  
