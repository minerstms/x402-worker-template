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

- [ ] Buyer URL guards for the new path and query shape (`src/buyer-guards.ts`)
- [ ] `.env.buyer.example` `API_URL` and remote origin documentation
- [ ] Buyer preflight and payment-path tests

## Payment (Base Sepolia only unless deliberately changed)

- [ ] Seller public address in ignored local `.dev.vars` only
- [ ] Dead placeholder remains in tracked `wrangler.toml` until supervised deploy
- [ ] Amount remains `1000` atomic units (0.001 test USDC) unless intentionally changed
- [ ] Asset remains Base Sepolia test USDC with EIP-712 `USDC` / `2`
- [ ] `syncFacilitatorOnStart: false` behavior preserved via production facilitator client

## Tests and docs

- [ ] Validation tests for new inputs
- [ ] Unpaid 402 tests (handler must not run)
- [ ] Payment requirement tests (exactly one Base Sepolia option)
- [ ] Buyer guard tests for local and remote URLs
- [ ] README describes the new domain honestly (no fabricated data)

## Deployment verification (Red lane — not part of template clone)

- [ ] Wrangler dry-run passes
- [ ] Deploy to workers.dev with seller address via Cloudflare vars/secrets only
- [ ] `/health` and `/openapi.json` return 200
- [ ] Valid unpaid request returns HTTP 402 promptly with expected payment terms
- [ ] Read-only `npm run buyer:diagnose` passes against deployed origin
- [ ] Exactly one controlled Base Sepolia test-USDC payment succeeds end-to-end

## Do not commit

- `.dev.vars`
- `.env.buyer`
- Real seller wallet addresses
- Real workers.dev deployment URLs (use examples or placeholders in tracked files)
- Private keys or payment signatures
