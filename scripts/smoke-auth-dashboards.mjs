#!/usr/bin/env node
/**
 * Smoke: register → verify (debug code) → login → dashboards.
 * Usage: node scripts/smoke-auth-dashboards.mjs [baseUrl]
 * Requires AUTH_DEBUG_TOKENS=true (or mail log) so register returns debugVerificationCode.
 */
const base = (process.argv[2] ?? 'http://localhost:3001').replace(/\/$/, '');
const api = `${base}/api/v1`;

async function req(path, { method = 'GET', body, token, org } = {}) {
  const res = await fetch(`${api}${path}`, {
    method,
    headers: {
      'Content-Type': 'application/json',
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
      ...(org ? { 'x-organization-id': org } : {}),
    },
    body: body ? JSON.stringify(body) : undefined,
  });
  const json = await res.json().catch(() => ({}));
  if (!res.ok || json.success === false) {
    const err = json?.error ?? json;
    throw new Error(`${method} ${path} → ${res.status} ${JSON.stringify(err)}`);
  }
  return json.data ?? json;
}

const stamp = Date.now();
const email = `smoke.${stamp}@example.com`;
const password = 'SmokeTestPass99';

console.log('API', api);
console.log('Register', email);
const reg = await req('/auth/register', {
  method: 'POST',
  body: {
    email,
    password,
    firstName: 'Smoke',
    lastName: 'Test',
    organizationName: `Smoke Co ${stamp}`,
  },
});
if (!reg.debugVerificationCode) {
  console.warn(
    'No debugVerificationCode — set AUTH_DEBUG_TOKENS=true or fix mail. Skipping verify.',
  );
  process.exit(0);
}
console.log('Verify code', reg.debugVerificationCode);
const session = await req('/auth/verify-email', {
  method: 'POST',
  body: { email, code: reg.debugVerificationCode },
});
const orgId = session.organizations?.[0]?.id;
console.log('Org', orgId);
const dash = await req('/analytics/dashboard?days=7', {
  token: session.accessToken,
  org: orgId,
});
console.log('Manufacturer sections', dash.meta?.sections);
console.log('Consumer dashboard…');
await req('/me/dashboard?days=7', { token: session.accessToken });
console.log('OK smoke passed');
