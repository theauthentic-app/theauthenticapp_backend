# Frontend: email verification (6-digit code)

Feed this to the frontend agent. Auth is **code-first**; deep-link tokens still work.

Parent doc (full auth + report flows): [FRONTEND_AUTH.md](./FRONTEND_AUTH.md).

Base path: `{API_BASE}/api/v1` (local default `http://localhost:3001/api/v1`).

Envelope (typical):

```json
{ "success": true, "data": { /* payload below */ } }
```

On error: `{ "success": false, "error": { "code": "…", "message": "…" } }`.

---

## Product rules

1. After **register**, do **not** expect `accessToken` / `refreshToken`. Session starts only after successful verify (or later login once verified).
2. Show a **6-digit code entry** screen (OTP-style). That is the primary UX.
3. Optionally support `?token=` on `/verify-email` for one-tap links from the email.
4. Login before verify returns **`EMAIL_NOT_VERIFIED`** (403) — send the user to the code screen and offer **Resend**.
5. Never invent verification success locally. Only trust `POST /auth/verify-email` success.

---

## Flow

```
register
  → save email locally (needed for code verify + resend)
  → route to /verify-email
  → user enters 6-digit code from inbox
  → POST /auth/verify-email { email, code }
  → save accessToken, refreshToken, user, organizations
  → continue (org onboarding / dashboard / consumer home)

deep link (optional)
  → /verify-email?token=…
  → POST /auth/verify-email { token }
  → same session save
```

---

## Endpoints

### `POST /auth/register`

**Body**

| Field | Required | Notes |
| --- | --- | --- |
| `email` | yes | |
| `password` | yes | ≥ 10 chars |
| `firstName` | yes | |
| `lastName` | yes | |
| `phone` | no | |
| `organizationName` | no | Creates manufacturer org + trial |

**`data` (important fields)**

```ts
{
  user: { id, email, firstName, lastName, … },
  organizations: Array<{ id, name, role, … }>,
  emailVerificationRequired: true,
  emailDelivered: boolean,   // false ⇒ SMTP/Resend failed; show resend + support copy
  emailProvider: 'smtp' | 'resend' | 'log' | string,
  message: string,
  // Only when delivery failed or non-production debug:
  debugVerificationCode?: string,   // e.g. "482910"
  debugVerificationToken?: string
}
```

**Frontend**

- Persist `email` for the verify screen.
- If `emailDelivered === false`, show “We couldn’t send email” + Resend; in local/dev you may prefill from `debugVerificationCode`.
- Do **not** treat register as logged-in.

---

### `POST /auth/verify-email`

Use **exactly one** of these shapes.

**A — Code (preferred UI)**

```json
{
  "email": "user@example.com",
  "code": "482910"
}
```

- `code` must be exactly **6 digits** (`/^\d{6}$/`).
- `email` must match the account from register.

**B — Deep-link token**

```json
{
  "token": "<base64url token from email link>"
}
```

**Success `data`**

```ts
{
  verified: true,
  user: { … },
  organizations: [ … ],
  accessToken: string,
  refreshToken: string,
  tokenType: "Bearer"
}
```

**Errors**

| `error.code` | HTTP | When |
| --- | --- | --- |
| `INVALID_REQUEST` | 400 | Missing both token and email+code |
| `INVALID_CODE` | 400 | Wrong / expired / already used code |
| `INVALID_TOKEN` | 400 | Wrong / expired / already used token |
| `RATE_LIMITED` | 429 | Too many code attempts for that email |

**Frontend**

- On success: store tokens the same way as login; then navigate onward.
- On `INVALID_CODE`: shake/clear the OTP inputs; do not clear email.
- Disable submit until 6 digits are entered.

---

### `POST /auth/resend-verification`

```json
{ "email": "user@example.com" }
```

**`data`**

```ts
{
  queued: true,
  emailDelivered: boolean,
  emailProvider: string,
  debugVerificationCode?: string,
  debugVerificationToken?: string
}
```

**Frontend**

- Cooldown button (e.g. 30–60s) to avoid spam.
- Always return a soft success UX (backend may no-op if already verified).
- New email **invalidates** the previous code; tell the user to use the latest email.

---

### `POST /auth/login` (related)

If `EMAIL_VERIFICATION_REQUIRED` is on and the user is unverified:

```json
{
  "success": false,
  "error": {
    "code": "EMAIL_NOT_VERIFIED",
    "message": "…"
  }
}
```

Route to `/verify-email` with that email prefilled + Resend.

---

## Suggested screens

### `/verify-email`

1. Title: Confirm your email  
2. Short copy: “We sent a 6-digit code to {email}.”  
3. OTP input (6 boxes or one masked field)  
4. Primary CTA: Verify  
5. Secondary: Resend code  
6. Optional: “Change email” → back to register/login  

Deep link support:

- Read `token` from query.
- If present, auto-call `POST /auth/verify-email` with `{ token }` once (show spinner); on failure fall back to code UI.

### Email content (for designers)

The message leads with a large **6-digit code**, then a “Verify email” button linking to:

`{APP_WEB_URL}/verify-email?token=…`

---

## Minimal client helpers

```ts
export async function verifyWithCode(apiBase: string, email: string, code: string) {
  const res = await fetch(`${apiBase}/auth/verify-email`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ email, code }),
  });
  const json = await res.json();
  if (!res.ok || json.success === false) {
    throw Object.assign(new Error(json?.error?.message ?? 'Verify failed'), {
      code: json?.error?.code,
      status: res.status,
    });
  }
  return json.data ?? json;
}

export async function resendVerification(apiBase: string, email: string) {
  const res = await fetch(`${apiBase}/auth/resend-verification`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ email }),
  });
  return res.json();
}
```

---

## Checklist

- [ ] Register → verify screen (no tokens yet)
- [ ] OTP submit → `email` + `code`
- [ ] Persist session from verify response
- [ ] Handle `EMAIL_NOT_VERIFIED` on login
- [ ] Resend with cooldown; use newest code only
- [ ] Optional `?token=` deep link
- [ ] Surface `emailDelivered === false` honestly
- [ ] Never show a hardcoded “verified” state without API success
