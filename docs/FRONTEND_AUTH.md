# Frontend: AUTHENTIC auth + account flows

Hand this to the frontend agent. Backend is live under `{API_BASE}/api/v1`  
(local default: `http://localhost:3001/api/v1`).

Related: [FRONTEND_EMAIL_VERIFICATION.md](./FRONTEND_EMAIL_VERIFICATION.md) (OTP details), [FRONTEND.md](./FRONTEND.md) (broader API).

---

## 0. Contract (read once)

### Envelope

Success:

```json
{
  "success": true,
  "data": { },
  "timestamp": "…",
  "requestId": "…"
}
```

Error:

```json
{
  "success": false,
  "error": { "code": "EMAIL_NOT_VERIFIED", "message": "…" },
  "timestamp": "…",
  "requestId": "…"
}
```

Always branch on `success` / HTTP status. Never invent auth or verification outcomes.

### Headers

| Header | When |
| --- | --- |
| `Content-Type: application/json` | All JSON bodies |
| `Authorization: Bearer {accessToken}` | Logged-in human routes (`/auth/me`, manufacturer APIs, …) |
| `x-organization-id: {orgPublicId}` | Manufacturer / org-scoped routes (use `organizations[].id` from login/register/verify/me) |

### Session storage (frontend)

| Key | Source | Notes |
| --- | --- | --- |
| `accessToken` | login / verify-email / refresh | Short-lived JWT |
| `refreshToken` | login / verify-email / refresh | Rotate on refresh; send on logout |
| `user` | login / verify / me | Public user object |
| `orgId` | `organizations[0].id` when manufacturer | Required for brand dashboard calls |

**“Remember me”** is **frontend-only**: same login API. If checked, persist `refreshToken` in durable storage; if unchecked, use session storage. There is no separate backend flag.

### Suggested routes

| Route | Purpose |
| --- | --- |
| `/register` | Sign up |
| `/login` | Sign in |
| `/verify-email` | 6-digit code (+ optional `?token=`) |
| `/forgot-password` | Request reset email |
| `/reset-password?token=` | Set new password |
| `/report` or scan-result “Report” | Report a product |
| App shell | Sign out |

Email deep links from the API use `APP_WEB_URL`:

- `{APP_WEB_URL}/verify-email?token=…`
- `{APP_WEB_URL}/reset-password?token=…`

---

## 1. Register

`POST /auth/register` — **public**

### Body

| Field | Required | Rules |
| --- | --- | --- |
| `email` | yes | Valid email |
| `password` | yes | **Min 10** characters |
| `firstName` | yes | |
| `lastName` | yes | |
| `phone` | no | |
| `organizationName` | no | If set → manufacturer workspace + trial |

### Success `data` (no session yet)

```ts
{
  user: {
    id: string;           // usr_…
    email: string;
    firstName: string;
    lastName: string;
    platformRole: string;
    emailVerified: false;
  },
  organizations: Array<{
    id: string;           // org_…  ← use as x-organization-id
    name: string;
    type: string;
    role: string;
    status: string;
  }>,
  emailVerificationRequired: true,
  emailDelivered: boolean,
  emailProvider: string,
  message: string,
  debugVerificationCode?: string,   // only when mail failed / non-prod
  debugVerificationToken?: string
}
```

### Errors

| code | HTTP | UI |
| --- | --- | --- |
| `EMAIL_IN_USE` | 409 | “Account already exists” → link to login |
| validation | 400 | Field errors (password too short, etc.) |

### Frontend flow

```
submit register
  → DO NOT store accessToken
  → save email (and org intent) locally
  → go to /verify-email
  → if emailDelivered === false: show “couldn’t send mail” + Resend
```

Consumer: omit `organizationName`.  
Manufacturer: send `organizationName` (company / brand house name).

---

## 2. Verify email (required before login)

`POST /auth/verify-email` — **public**

### Body — pick one

**A. Code (primary UI)**

```json
{ "email": "user@example.com", "code": "482910" }
```

`code` = exactly **6 digits**.

**B. Deep link**

```json
{ "token": "<from ?token= query>" }
```

### Success `data` — **session starts here**

```ts
{
  verified: true,
  user: { id, email, firstName, lastName, platformRole, emailVerified: true },
  organizations: [ … ],
  accessToken: string,
  refreshToken: string,
  tokenType: "Bearer"
}
```

Store tokens + user + default `orgId` exactly like login.

### Errors

| code | HTTP | UI |
| --- | --- | --- |
| `INVALID_REQUEST` | 400 | Missing token and email+code |
| `INVALID_CODE` | 400 | Wrong / expired code |
| `INVALID_TOKEN` | 400 | Bad / used link |
| `RATE_LIMITED` | 429 | Too many code tries |

### Resend

`POST /auth/resend-verification`

```json
{ "email": "user@example.com" }
```

```ts
{
  queued: true,
  emailDelivered: boolean,
  emailProvider: string,
  debugVerificationCode?: string,
  debugVerificationToken?: string
}
```

Cooldown the button 30–60s. New email **invalidates** the old code.

---

## 3. Login

`POST /auth/login` — **public** · HTTP 200

```json
{ "email": "user@example.com", "password": "…………" }
```

### Success `data`

```ts
{
  user: { id, email, firstName, lastName, platformRole, emailVerified },
  organizations: [ … ],
  accessToken: string,
  refreshToken: string,
  tokenType: "Bearer"
}
```

### Errors

| code / status | HTTP | UI |
| --- | --- | --- |
| Unauthorized (bad credentials) | 401 | Generic “email or password incorrect” |
| `EMAIL_NOT_VERIFIED` | 403 | Route to `/verify-email` + Resend |
| `ACCOUNT_LOCKED` | 423 | “Try again later” |
| `ACCOUNT_INACTIVE` | 403 | Support / blocked |
| `RATE_LIMITED` | 429 | Slow down |

After login: if `organizations.length > 0` and type is manufacturer, set `orgId` and enter brand app; else consumer home.

---

## 4. Current user

`GET /auth/me` — **Bearer required** (human JWT)

### Success `data`

```ts
{
  user: { id, email, firstName, lastName, platformRole, emailVerified },
  organizations: [ … ]
}
```

Use on app boot to restore profile when tokens exist.

---

## 5. Refresh session

`POST /auth/refresh` — **public**

```json
{ "refreshToken": "…" }
```

### Success `data`

```ts
{
  accessToken: string,
  refreshToken: string,   // NEW — replace stored refresh
  tokenType: "Bearer"
}
```

### Frontend policy

```
API 401
  → POST /auth/refresh with stored refreshToken
  → on success: save both tokens, retry original request once
  → on failure: clear storage → /login
```

Old refresh token is revoked when rotated (one-time use).

---

## 6. Sign out (logout)

`POST /auth/logout` — **public** (still send the refresh token)

```json
{ "refreshToken": "…" }
```

### Success `data`

```ts
{ revoked: true }
```

### Frontend

1. Call logout with current `refreshToken` (best-effort; ignore network errors).
2. Clear `accessToken`, `refreshToken`, `user`, `orgId`.
3. Navigate to `/login`.

Do **not** keep using a revoked refresh token.

---

## 7. Forgot password

`POST /auth/forgot-password` — **public**

```json
{ "email": "user@example.com" }
```

### Success `data`

```ts
{
  queued: true,
  emailDelivered?: boolean,
  emailProvider?: string,
  debugResetToken?: string   // only when mail failed / non-prod
}
```

Always show a soft success (“If an account exists, we sent a reset link”) — backend avoids email enumeration.

Rate limit: `RATE_LIMITED` (429) after too many requests per email.

Email link: `{APP_WEB_URL}/reset-password?token=…` (expires in **30 minutes**).

### UI

1. Email field + Submit  
2. Confirmation copy  
3. Link back to login  

---

## 8. Reset password (“remember / set new password”)

`POST /auth/reset-password` — **public**

Prefer the same OTP UX as email verify. Deep-link token still works.

**A — Code (preferred)**

```json
{
  "email": "user@example.com",
  "code": "482910",
  "password": "newpassword10+"
}
```

**B — Deep link**

```json
{
  "token": "<from email query ?token=>",
  "password": "newpassword10+"
}
```

Password **min 10** chars. Code expires in **30 minutes**.

Forgot response may include `debugResetCode` / `debugResetToken` when `AUTH_DEBUG_TOKENS=true`.

### Success `data`

```ts
{ reset: true }
```

### Errors

| code | HTTP | UI |
| --- | --- | --- |
| `INVALID_REQUEST` | 400 | Missing token and email+code |
| `INVALID_CODE` | 400 | Wrong / expired code |
| `INVALID_TOKEN` | 400 | Link expired / already used → forgot-password again |
| `RATE_LIMITED` | 429 | Too many code attempts |
| validation | 400 | Password too short |

### Frontend flow

```
/forgot-password { email }
  → /reset-password (enter 6-digit code + new password)
  → or /reset-password?token=… (link)
  → POST /auth/reset-password
  → /login “Password updated, sign in”
```

All existing sessions for that user are revoked server-side after reset. User must log in again (there are **no** tokens in the reset response).

---

## 9. Report a product

`POST /reports` — **public** (optional Bearer if logged in)

Attach the scan code when available so the report links to a product identity.

### Body

| Field | Required | Notes |
| --- | --- | --- |
| `reason` | **yes** | Enum below |
| `description` | no | Free text |
| `code` | no | Scanned QR / serial / credential value |
| `city` | no | |
| `country` | no | e.g. `NG` |

### `reason` values

```
COUNTERFEIT
PACKAGING
WRONG_INFO
EXPIRED
RECALLED
FAKE_SELLER
DUPLICATE_CODE
OTHER
```

### Success `data`

```ts
{ id: string; status: "OPEN" | string }  // id like rpt_…
```

### Example

```json
{
  "reason": "COUNTERFEIT",
  "description": "Hologram missing, seller on Instagram",
  "code": "AX92819",
  "city": "Lagos",
  "country": "NG"
}
```

### Frontend

- From verify/scan result: prefill `code` from the scan.
- Reason = select / chips mapped 1:1 to enum (do not invent values).
- Works logged-out; if Bearer is present, report is attributed to the user.
- Consumer status: `GET /me/reports` (Bearer).
- Manufacturer inbox: `GET /reports` with Bearer + `x-organization-id` (org staff).
- Platform triage: `PATCH /admin/reports/:id` `{ status, reviewOutcome? }`.

---

## 10. End-to-end maps

### A. New manufacturer

```
/register { …, organizationName }
  → /verify-email { email, code }
  → store tokens + orgId
  → brand dashboard (x-organization-id)
```

### B. New consumer

```
/register { … }           // no organizationName
  → /verify-email
  → store tokens
  → scan / wallet / history
```

### C. Returning user

```
/login
  → if EMAIL_NOT_VERIFIED → /verify-email
  → else store tokens → home
```

### D. Forgot → reset

```
/forgot-password { email }
  → email link /reset-password?token=
  → POST /auth/reset-password
  → /login
```

### E. Sign out

```
POST /auth/logout { refreshToken }
  → clear local session
  → /login
```

### F. Report after scan

```
scan/verify result
  → Report CTA
  → POST /reports { reason, code, … }
  → thank-you / ticket id
```

---

## 11. Error handling cheat sheet

| Situation | `error.code` | Frontend action |
| --- | --- | --- |
| Duplicate signup | `EMAIL_IN_USE` | Offer login |
| Unverified login | `EMAIL_NOT_VERIFIED` | Verify screen |
| Bad login | (401) | Generic credentials message |
| Locked | `ACCOUNT_LOCKED` | Wait / support |
| Bad OTP | `INVALID_CODE` | Clear OTP, keep email |
| Bad verify link | `INVALID_TOKEN` | Offer resend |
| Bad reset link | `INVALID_TOKEN` | Offer forgot again |
| Spammy | `RATE_LIMITED` | Cooldown UI |
| Expired access | 401 | Refresh once, else logout |

---

## 12. Minimal TypeScript client sketches

```ts
const api = (path: string, init?: RequestInit) =>
  fetch(`${API_BASE}${path}`, {
    ...init,
    headers: {
      'Content-Type': 'application/json',
      ...(init?.headers ?? {}),
    },
  }).then(async (res) => {
    const json = await res.json();
    if (!res.ok || json.success === false) {
      throw Object.assign(new Error(json?.error?.message ?? res.statusText), {
        code: json?.error?.code,
        status: res.status,
      });
    }
    return json.data ?? json;
  });

// Register → verify
await api('/auth/register', { method: 'POST', body: JSON.stringify(body) });
const session = await api('/auth/verify-email', {
  method: 'POST',
  body: JSON.stringify({ email, code }),
});

// Login / logout
const session2 = await api('/auth/login', {
  method: 'POST',
  body: JSON.stringify({ email, password }),
});
await api('/auth/logout', {
  method: 'POST',
  body: JSON.stringify({ refreshToken: session2.refreshToken }),
});

// Forgot / reset
await api('/auth/forgot-password', {
  method: 'POST',
  body: JSON.stringify({ email }),
});
await api('/auth/reset-password', {
  method: 'POST',
  body: JSON.stringify({ token, password: newPassword }),
});

// Report
await api('/reports', {
  method: 'POST',
  body: JSON.stringify({
    reason: 'COUNTERFEIT',
    code: scannedCode,
    description,
    country: 'NG',
  }),
  headers: accessToken
    ? { Authorization: `Bearer ${accessToken}` }
    : undefined,
});
```

---

## 13. Frontend checklist

- [ ] Register never treats response as logged-in
- [ ] Verify email (code UI + optional `?token=`)
- [ ] Resend with cooldown
- [ ] Login handles `EMAIL_NOT_VERIFIED`
- [ ] Remember me = storage choice only
- [ ] Refresh-on-401 with token rotation
- [ ] Logout revokes refresh + clears storage
- [ ] Forgot password soft-success copy
- [ ] Reset password from `?token=` (min 10)
- [ ] Report product with `ReportReason` enum + optional `code`
- [ ] Manufacturer calls send `x-organization-id`
- [ ] Never hardcode pass/fail for product verify (separate from email verify)

---

## 14. What the backend already does

| Feature | Status |
| --- | --- |
| Register (+ optional manufacturer org) | Done |
| Email verify via 6-digit code or link token | Done |
| Resend verification | Done |
| Login + lockout + rate limits | Done |
| Refresh rotation | Done |
| Logout (revoke refresh) | Done |
| Forgot password email (30 min) | Done |
| Reset password + revoke sessions | Done |
| `/auth/me` | Done |
| Report product (public + optional auth) | Done |

No extra backend work is required for the flows above.
