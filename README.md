# x402 Paid Worker Template

Payment-verified Cloudflare Worker template using [Hono](https://hono.dev/) and [x402](https://x402.org/) v2 on **Base Sepolia only**.

## What this is

A reusable starting point for paid HTTP APIs on Cloudflare Workers. It preserves the payment system proven in the river reference implementation and replaces domain-specific logic with a small deterministic example route.

**Verified origin:** `x402-usgs-river-snapshot@f3d8f24` (Git tag `payment-verified-base-sepolia-v1`)

**Verification level:**

- Node CLI Base Sepolia test-USDC payment verified against the river reference Worker
- Browser MetaMask Base Sepolia test-USDC payment verified on 2026-07-23 against the dedicated demonstration Worker `x402-worker-template-testnet`

See [docs/BASE_SEPOLIA_BROWSER_PAYMENT_PROOF.md](./docs/BASE_SEPOLIA_BROWSER_PAYMENT_PROOF.md) for the live browser proof record on the **source template's** dedicated demonstration Worker only.

A successful fresh clone/rename drill was completed in the separate evidence repository `x402-clone-drill@65c8c21`. That clone has **not** performed a live payment and must not inherit the source proof.

Mainnet and real USDC are not supported. The template is **not yet clone-ready**.

## Routes

| Route | Access | Description |
| --- | --- | --- |
| `GET /health` | Free | Liveness check |
| `GET /openapi.json` | Free | OpenAPI document |
| `GET /v1/example?value=<text>` | Paid (x402) | Deterministic example response |
| `GET /pay` | Free | MetaMask payment page (disabled while placeholder seller is configured in tracked source) |
| `GET /pay/config` | Free | Public Base Sepolia payment configuration for the browser page |

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

Browser payment at `/pay` uses MetaMask on Base Sepolia. **No customer private key is required** for browser customers. The tracked seller remains a dead placeholder, so signing and payment submission stay disabled in the default local template configuration.

The dedicated demonstration Worker `x402-worker-template-testnet` has a verified browser payment on 2026-07-23:

- Buyer balance decreased by **0.001** test USDC
- Seller balance increased by **0.001** test USDC

Another live payment is not required for the current milestone.

Mainnet remains unsupported. One explicit click authorizes at most one testnet payment attempt when payment is enabled. Uncertain submission must never be retried automatically.

## Commands

```bash
npm run test          # Vitest unit/integration tests
npm run build:browser # Build same-origin /pay.js bundle
npm run typecheck     # TypeScript --noEmit
npm run build         # Browser build + Wrangler deploy dry-run → dist/
npx wrangler deploy --dry-run   # Bundle/check without deploying
```

## Cloning checklist

When creating a new project from this template, see [TEMPLATE_CHECKLIST.md](./TEMPLATE_CHECKLIST.md).

Shared paid-route constants live in `src/pay-public-config.ts` (`PAID_ROUTE`, `ALLOWED_QUERY_KEY`, `BROWSER_DEMO_QUERY_VALUE`, `buildPaidRouteUrl`). Buyer guards and browser terms loading must continue to use those constants rather than hardcoding route paths or query keys.

`test/clone-surfaces.test.ts` documents the small set of files a future clone should edit.

## Red-lane warnings

- Do not deploy, configure Cloudflare secrets, or run paid buyer commands without explicit authorization.
- Do not commit private keys, seller addresses, or `.dev.vars` / `.env.buyer`.
- Do not enable Base mainnet or change the locked Base Sepolia payment terms without a deliberate security review.
- A fresh tracked-source clone/rename drill is still required before calling the template clone-ready.

## Provenance

Derived from the payment-verified river Worker at commit `f3d8f24`. The river project remains the frozen reference; this template is the generalized clone surface.
