# Database

PostgreSQL via Prisma. Schema: `prisma/schema.prisma`.

Core tables:

- `User`, `RefreshToken`, `PasswordReset`, `EmailVerificationToken`
- `Organization`, `OrganizationMember`
- `Brand`, `Product`, `ProductVariant`, `Batch`
- `ProductIdentity`, `Credential`
- `Verification`, `RiskSignal`
- `ProductReport`, `Recall`, `Warranty`, `SupplyChainEvent`, `InventoryItem`
- `ApiKey`, `WebhookEndpoint`, `WebhookDelivery`
- `Notification`, `StoredFile`, `AuditLog`, `IdempotencyKey`, `TrustScoreWeight`

Public identifiers (`publicId`) are random and used in APIs. Internal `id` values are CUIDs and are not required by clients.

Indexes cover credential hashes, serials, GTINs, ISBNs, SKUs, batch numbers, verification timestamps, and organization foreign keys.

Migrations: `npx prisma migrate dev`.
