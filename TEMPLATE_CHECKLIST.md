# Template clone checklist

Use this list when copying `x402-worker-template` into a new paid Worker project.

## Identity

- [ ] Service title (`SERVICE_NAME` in `src/config.ts`)
- [ ] Service id (`SERVICE_ID` in `src/config.ts`)
- [ ] npm package name (`package.json`)
- [ ] Wrangler Worker name (`wrangler.toml`)
- [ ] OpenAPI title and description (`src/openapi.ts`)
- [ ] Health service label (`src/routes/health.ts` uses `SERVICE_NAME`)
- [ ] README project name and description

## Route and domain

- [ ] Paid route path (replace `/v1/example`)
- [ ] Request validation middleware (replace `src/routes/example.ts`)
- [ ] Domain handler implementation (no external calls unless explicitly intended)
- [ ] OpenAPI path, parameters, and response schemas
- [ ] Payment route config (`buildExampleRouteConfig` → renamed in `src/payment.ts`)
- [ ] `src/index.ts` middleware and handler wiring

## Buyer safety

- [x] `/pay` browser payment code exists
- [x] Browser page cannot sign or submit payment until `paymentReady: true`
- [x] Browser fetch receiver binding prevents detached `fetch` illegal invocation
- [x] `/pay`, `/pay.js`, `/pay.css`, and `/pay/config` use `Cache-Control: no-store`
- [x] Shared paid-route constants and `buildPaidRouteUrl` live in `src/pay-public-config.ts`
- [x] Buyer guards and browser terms loading use shared route/query constants
- [x] Clone surface contract test (`test/clone-surfaces.test.ts`)
- [ ] Buyer URL guards for the new path and query shape (`src/buyer-guards.ts`; import `PAID_ROUTE` and `ALLOWED_QUERY_KEY` from `src/pay-public-config.ts`)
- [ ] `.env.buyer.example` `API_URL` and remote origin documentation
- [ ] Buyer preflight and payment-path tests

## Payment (Base Sepolia only unless deliberately changed)

- [ ] Seller public address in ignored local `.dev.vars` only
- [ ] Dead placeholder remains in tracked `wrangler.toml` until supervised deploy
- [ ] Amount remains `1000` atomic units (0.001 test USDC) unless intentionally changed
- [ ] Asset remains Base Sepolia test USDC with EIP-712 `USDC` / `2`
- [ ] `syncFacilitatorOnStart: false` behavior preserved via production facilitator client

## Verified Base Sepolia milestones (reference template)

- [x] Fresh tracked-source clone/rename drill succeeded (`x402-clone-drill@65c8c21`, evidence only)
- [x] MetaMask wallet connection
- [x] Base Sepolia network switching
- [x] Strict unpaid HTTP 402 validation
- [x] Bound-quote signing without second unpaid 402 fetch
- [x] One explicit MetaMask signature per click
- [x] One payment attempt per click (code-enforced)
- [x] HTTP paid flow success on dedicated testnet Worker
- [x] Buyer balance decreased by exactly 0.001 test USDC (2026-07-23 proof)
- [x] Seller balance increased by exactly 0.001 test USDC (2026-07-23 proof)
- [x] No duplicate payment observed in live browser proof
- [x] Browser fetch receiver fix deployed to `x402-worker-template-testnet`
- [x] Testnet deployment proof documented in `docs/BASE_SEPOLIA_BROWSER_PAYMENT_PROOF.md`

## Tests and docs

- [ ] Validation tests for new inputs
- [ ] Unpaid 402 tests (handler must not run)
- [ ] Payment requirement tests (exactly one Base Sepolia option)
- [x] Browser `/pay` preflight and success UX tests
- [ ] Buyer guard tests for local and remote URLs
- [ ] README describes the new domain honestly (no fabricated data)

## Deployment verification (Red lane — not part of template clone)

- [ ] Wrangler dry-run passes
- [ ] Deploy to workers.dev with seller address via Cloudflare vars/secrets only
- [ ] `/health` and `/openapi.json` return 200
- [ ] Valid unpaid request returns HTTP 402 promptly with expected payment terms
- [ ] `/pay` loads and reports placeholder seller as not payment-ready in tracked-source clone
- [ ] Read-only `npm run buyer:diagnose` passes against deployed origin
- [ ] Exactly one controlled Base Sepolia test-USDC payment succeeds end-to-end

## Not complete yet

- [ ] Mainnet payment
- [ ] Real USDC
- [ ] Final tracked-source clone/rename drill
- [ ] Final version tag
- [ ] Clone-ready status

`docs/BASE_SEPOLIA_BROWSER_PAYMENT_PROOF.md` records the source template's live browser payment only. Clones must not treat it as proof of their own payment.

## Do not commit

- `.dev.vars`
- `.env.buyer`
- Real seller wallet addresses
- Real workers.dev deployment URLs (use examples or placeholders in tracked files)
- Private keys or payment signatures
