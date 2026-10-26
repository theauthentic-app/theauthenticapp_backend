# Security

- Passwords hashed with Argon2. Refresh tokens stored as SHA-256 hashes and rotated on use.
- Access JWTs are short-lived (`JWT_ACCESS_TTL`, default 15m).
- Organization membership is loaded server-side. `x-organization-id` is treated as a public id and mapped internally; clients cannot assert a role.
- Helmet, CORS allowlist, ValidationPipe whitelist, Prisma parameterized queries.
- Login and verification endpoints are rate-limited (Redis when available, Nest throttler globally).
- Credentials are stored as hashes plus a short hint. Raw API key secrets are returned once and stored hashed.
- Verification never returns ORIGINAL/FAKE. Internal fraud weights are not exposed on public responses.
- Audit logs are append-only application records for sensitive enterprise actions.
- Secrets live in environment variables. Do not commit `.env`.

Account lockout: 8 failed passwords locks the account for 15 minutes.
