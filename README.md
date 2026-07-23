# x402 Paid Worker Template

Payment-verified Cloudflare Worker template using [Hono](https://hono.dev/) and [x402](https://x402.org/) v2 on **Base Sepolia only**.

## What this is

A reusable starting point for paid HTTP APIs on Cloudflare Workers. It preserves the payment system proven in the river reference implementation and replaces domain-specific logic with a small deterministic example route.

**Verified origin:** `x402-usgs-river-snapshot@f3d8f24` (Git tag `payment-verified-base-sepolia-v1`)

**Verification level:** one successful Base Sepolia test-USDC payment and settlement against the river reference Worker. This template generalizes that code path; it does not include mainnet behavior.

## Routes

| Route | Access | Description |
| --- | --- | --- |
| `GET /health` | Free | Liveness check |
| `GET /openapi.json` | Free | OpenAPI document |
| `GET /v1/example?value=<text>` | Paid (x402) | Deterministic example response |

Payment defaults (overridable via local env): Base Sepolia (`eip155:84532`), **0.001** test USDC (`1000` atomic units).

## Local setup

Use the example templates only. Never commit real secrets.

```bash
npm install

# Worker local vars (Wrangler)
copy .dev.vars.example .dev.vars
# Edit .dev.vars locally with your own values

# Optional buyer script env
copy .env.buyer.example .env.buyer
# Edit .env.buyer locally with your own values

npm run dev
```

On macOS/Linux, use `cp` instead of `copy`.

**Never commit `.dev.vars` or `.env.buyer`.** Only the `.example` files belong in Git.

The tracked pay-to address is the zero/dead placeholder. Do not attempt payment while that placeholder is configured unless you are following a supervised testnet step with a real receiving wallet set only in ignored local files.

## Buyer safety

Local buyer tests may use:

- `http://localhost:8787/v1/example?value=hello`
- `http://127.0.0.1:8787/v1/example?value=hello`

Remote workers.dev tests require both:

- `API_URL=<full paid endpoint URL on that exact origin>`
- `EXPECTED_REMOTE_API_ORIGIN=<exact https://…workers.dev origin>`

Read-only preflight (no signing, no payment):

```bash
npm run buyer:diagnose
```

## Commands

```bash
npm run test          # Vitest unit/integration tests
npm run typecheck     # TypeScript --noEmit
npm run build         # Wrangler deploy dry-run → dist/
npx wrangler deploy --dry-run   # Bundle/check without deploying
```

## Cloning checklist

When creating a new project from this template, see [TEMPLATE_CHECKLIST.md](./TEMPLATE_CHECKLIST.md).

## Red-lane warnings

- Do not deploy, configure Cloudflare secrets, or run paid buyer commands without explicit authorization.
- Do not commit private keys, seller addresses, or `.dev.vars` / `.env.buyer`.
- Do not enable Base mainnet or change the locked Base Sepolia payment terms without a deliberate security review.
- Verify unpaid HTTP 402 and one controlled testnet payment after deployment before treating a clone as production-ready.

## Provenance

Derived from the payment-verified river Worker at commit `f3d8f24`. The river project remains the frozen reference; this template is the generalized clone surface.
