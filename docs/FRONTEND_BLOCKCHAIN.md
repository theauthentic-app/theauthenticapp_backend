# Frontend guide: mail fallback + blockchain identity proofs

Feed this to the frontend team / agent. Stay verification-first: crypto anchors **proof of existence**, it does not replace AUTHENTIC verify status.

Related: [FRONTEND.md](FRONTEND.md) · [ENV.md](ENV.md) · [API.md](../API.md)

---

## 1. Mail (backend behaviour — no FE change required)

| Priority | When |
| --- | --- |
| **1. Resend** | `RESEND_API_KEY` set |
| **2. Nodemailer SMTP** (Gmail later) | Resend missing/fails **and** `SMTP_HOST` set |
| **3. Log** | Neither works |

Frontend still uses the same auth APIs:

- `POST /auth/register` → `emailVerificationRequired: true` (no tokens until verify)
- `POST /auth/verify-email` `{ email, code }` (6-digit) **or** `{ token }` → tokens
- `POST /auth/login` → `403 EMAIL_NOT_VERIFIED` if not verified
- `POST /auth/resend-verification` `{ email }` → new code + link  
  Full OTP contract: [FRONTEND_EMAIL_VERIFICATION.md](./FRONTEND_EMAIL_VERIFICATION.md)

Set `APP_WEB_URL` to the frontend origin so email links open your verify page.

---

## 2. What blockchain does here (and what it does not)

### Does
- Creates a **commitment hash** of each unit (`publicId + signature + org + issuedAt`) — **no PII on-chain**
- Batches commitments into a **Merkle tree**
- Optionally submits the **Merkle root** to an EVM registry contract
- Exposes proof + explorer link for consumers and manufacturers

### Does not
- Replace `AUTHENTICATED` / `SUSPICIOUS` / etc. (still computed off-chain)
- Mint an NFT per unit by default (too expensive / noisy for mass serialization)
- Turn AUTHENTIC into a wallet or multi-currency exchange

**Native currencies** (`ETH`, `POL`, `BNB`, …) appear only as **gas/network metadata** for the active chain — not as user balances.

---

## 3. Public endpoints to expose in the UI

Base: `{API}/api/v1`

### Status & chains

```http
GET /public/blockchain/status
```

```json
{
  "enabled": true,
  "liveSubmit": false,
  "chain": {
    "key": "polygon-amoy",
    "chainId": 80002,
    "name": "Polygon Amoy",
    "nativeCurrency": "POL",
    "testnet": true
  },
  "registryAddress": null,
  "supportedChains": [
    { "key": "ethereum", "chainId": 1, "name": "Ethereum", "nativeCurrency": "ETH", "testnet": false },
    { "key": "polygon", "chainId": 137, "name": "Polygon", "nativeCurrency": "POL", "testnet": false },
    { "key": "base", "chainId": 8453, "name": "Base", "nativeCurrency": "ETH", "testnet": false }
  ],
  "note": "…"
}
```

```http
GET /public/blockchain/chains
```

Use for a “Supported networks” footer or manufacturer settings explainer.

### Per-identity proof

```http
GET /public/identities/:id/blockchain
```

`:id` = product identity public id (`pid_…`).

```json
{
  "status": "PENDING" | "QUEUED" | "ANCHORED" | "FAILED" | "DISABLED",
  "commitment": "a1b2…",
  "chainKey": "polygon-amoy",
  "chainId": 80002,
  "chainName": "Polygon Amoy",
  "nativeCurrency": "POL",
  "txHash": "0x…",
  "blockNumber": "123456",
  "merkleRoot": "…",
  "merkleProof": ["…", "…"],
  "leafIndex": 3,
  "explorerUrl": "https://amoy.polygonscan.com/tx/0x…",
  "anchoredAt": "2026-10-27T…",
  "verifiedLocally": true
}
```

| `status` | UI |
| --- | --- |
| `DISABLED` | Hide blockchain section (feature off) |
| `PENDING` / `QUEUED` | “Securing on-chain proof…” |
| `ANCHORED` | Show badge + link `explorerUrl` |
| `FAILED` | Soft warning; still show off-chain verify result |

`verifiedLocally: true` means Merkle proof checks out against the root in our DB (client can re-check the same way if desired).

### Manufacturer re-queue

```http
POST /product-identities/:id/anchor
Authorization: Bearer …
x-organization-id: org_…
```

Returns the same proof object after re-queue.

---

## 4. Verify response — new `blockchain` field

`POST /public/verify` and `POST /public/scan` now include:

```json
{
  "status": "AUTHENTICATED",
  "trustScore": 94,
  "identity": { "id": "pid_…", "status": "ACTIVE" },
  "blockchain": {
    "status": "ANCHORED",
    "commitment": "…",
    "explorerUrl": "https://…",
    "nativeCurrency": "POL",
    "verifiedLocally": true
  }
}
```

**UI rule:** always lead with `status` + `guidance`. Blockchain is a **secondary trust signal** (“Also registered on Polygon”).

Suggested consumer card:

```
✓ Authenticated
Trust score 94
[ On-chain · Polygon · View tx ↗ ]
```

If `blockchain.status === "DISABLED"` or `null`, omit the row.

---

## 5. After mint (manufacturer)

`POST /product-identities/generate` returns:

```json
{
  "count": 10,
  "identities": [
    {
      "publicId": "pid_…",
      "serialNumber": "…",
      "verifyUrl": "https://app…/scan?code=pid_…",
      "labelUrl": "https://api…/product-identities/pid_…/label",
      "blockchainUrl": "https://api…/public/identities/pid_…/blockchain"
    }
  ],
  "blockchain": { "enabled": true, "liveSubmit": false, "chain": { "key": "polygon-amoy", "nativeCurrency": "POL" } }
}
```

Show a note: “Units queued for on-chain anchoring” when `blockchain.enabled` is true.

---

## 6. Health (ops)

`GET /health` → `data.blockchain`:

```json
{
  "enabled": true,
  "liveSubmit": false,
  "chain": "polygon-amoy",
  "nativeCurrency": "POL"
}
```

`data.mail.fallback` is `"smtp"` when both Resend and SMTP are configured.

---

## 7. Env the frontend should know about (read-only)

Backend (not browser secrets):

| Var | Purpose |
| --- | --- |
| `BLOCKCHAIN_ENABLED=true` | Queue commitments on mint |
| `BLOCKCHAIN_CHAIN_KEY` | e.g. `polygon-amoy`, `base`, `ethereum` |
| `BLOCKCHAIN_RPC_URL` | JSON-RPC for live submit |
| `BLOCKCHAIN_PRIVATE_KEY` | Server signer (never expose to FE) |
| `BLOCKCHAIN_REGISTRY_ADDRESS` | Deployed `AuthenticRegistry` |

Frontend only needs the **public API** above — never the private key.

---

## 8. Suggested React usage

```ts
// After verify
const proof = data.blockchain;
if (proof && proof.status !== 'DISABLED') {
  // render badge
  if (proof.status === 'ANCHORED' && proof.explorerUrl) {
    // <a href={proof.explorerUrl} target="_blank" rel="noreferrer">View on-chain</a>
  }
}

// Standalone
const proof = await api(`/public/identities/${pid}/blockchain`);
```

Do **not** invent on-chain status client-side. Poll `GET …/blockchain` every ~30s while `PENDING`/`QUEUED` if you show a live badge.

---

## 9. Core product reminder

| Layer | Source of truth |
| --- | --- |
| Is this pack authentic right now? | `POST /public/verify` → `status` |
| Was this unit committed immutably? | `blockchain` proof / explorer |
| Who paid for the plan? | Billing (NGN / Paystack) — separate from chain gas |

Keep crypto as an **integrity rail**, not the primary UX.
