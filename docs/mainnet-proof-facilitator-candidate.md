# Mainnet proof facilitator candidate (PayAI)

This document records the **immutable proof facilitator candidate** for one future bounded Base-mainnet payment proof. It does **not** select a production facilitator, enable the mainnet paid route, configure a seller, or authorize real-money use.

## Status terminology

| Term | Value |
| --- | --- |
| PayAI proof facilitator candidate | PayAI |
| Candidate URL | `https://facilitator.payai.network` |
| Proof facilitator status | `candidate-not-live-verified` |
| Production facilitator not selected | `false` |
| Production mainnet route disabled | `false` enabled flag in source |
| Seller not configured | yes (no tracked seller) |
| Payment ready false | `false` |
| Real-payment compatibility | not yet empirically proven |

PayAI is documented here as a **candidate for a future bounded proof**, not as the permanent or production facilitator. Native Base-USDC compatibility is **not yet empirically proven with PayAI**. A **1000 atomic-unit payment is not yet empirically proven with PayAI**. A **bounded real-payment proof requires separate authorization**.

## Immutable candidate configuration

Source: `src/mainnet/proof-facilitator-candidate.mainnet.ts`

| Field | Value |
| --- | --- |
| Name | PayAI |
| Origin | `https://facilitator.payai.network` |
| Supported path | `/supported` |
| Verify path | `/verify` |
| Settle path | `/settle` |
| Timeout | `10_000` ms (immutable) |
| Max response body | `256 KiB` |

Production-shaped exact-origin adapter (not wired into `src/index.mainnet.ts`):

- `src/mainnet/proof-facilitator-client.mainnet.ts`
- `src/mainnet/proof-facilitator-http.mainnet.ts`
- `src/mainnet/proof-facilitator-response-validation.mainnet.ts`

The adapter replaces direct `HTTPFacilitatorClient` use for the candidate because the installed client does not support injected fetch, `redirect: "error"`, bounded response reads, or disabling automatic `/supported` retries.

## Adapter safety boundary (pre-live)

The adapter exists before any live activation to enforce:

- **Exact-origin egress** — only `https://facilitator.payai.network` with exact `/supported`, `/verify`, and `/settle` paths
- **Fail-closed response validation** — installed-shaped supported/verify/settle schemas
- **Bounded response size** — reject excessive `Content-Length` and stream over `256 KiB`
- **No redirects** — `redirect: "error"`
- **No automatic retries** — including no `/supported` retry on HTTP 429
- **Mockable transport** — injected `fetch` only in tests and future bounded proof wiring
- **Safe error handling** — no raw body, headers, wallet material, or dependency `error.message` leakage
- **No authentication** — no API keys, JWT, Bearer, Basic, cookies, or seller registration tokens

No live `/verify` or `/settle` request is performed by the disabled production entry.

## Official evidence reviewed (2026-07-24)

Primary sources only. Permitted requests: GET / HEAD / OPTIONS. No verify/settle POST, no payment payload, no signature, no Base RPC.

1. **Candidate URL** — PayAI docs and live service use exactly `https://facilitator.payai.network`.
2. **x402 v2 `exact` on `eip155:8453`** — Live `GET /supported` advertises `{ x402Version: 2, scheme: "exact", network: "eip155:8453" }`.
3. **EIP-3009** — PayAI x402 reference documents the exact EVM scheme as EIP-3009 `transferWithAuthorization`.
4. **Documented paths** — `/verify`, `/settle`, and `/supported` are the documented facilitator REST paths.
5. **Free-tier discovery** — PayAI public landing/docs describe starting without merchant API keys for facilitator discovery; merchant JWT auth is documented for production merchant flows, not required to read `/supported`.
6. **Native Base USDC contract** — PayAI `/supported` advertises network/scheme kinds only; it does **not** directly advertise native Base USDC contract `0x833589…` support.
7. **Amount `"1000"`** — Not empirically tested against PayAI in this repository.
8. **Production behavior** — Remains unproven until a separate controlled real-payment task authorizes it.

Local evidence snapshots may be stored in ignored `payai-supported.json`; tracked source keeps only the immutable candidate constants above.

## Current runtime posture

- `src/index.mainnet.ts` keeps `GET /v1/example` at `503 NOT_ENABLED`.
- Orchestrator tests inject either `createMockFacilitatorClient()` or the PayAI adapter with injected fake fetch.
- `wrangler.mainnet.toml` contains no facilitator URL or seller configuration.
- `createProofFacilitatorCandidateHttpClient()` exists for future bounded proof wiring and is **not** constructed by the production mainnet entry.

## Mainnet payment policy (unchanged)

| Field | Value |
| --- | --- |
| Scheme | `exact` |
| Network | `eip155:8453` |
| Asset | Native Base USDC `0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913` |
| Amount | `"1000"` |
| EIP-712 | `USD Coin` / `2` |
| Timeout | `300` seconds |
| Payment identifier | required |

Policy module: `src/mainnet/payment-policy.mainnet.ts`

## What this document does not claim

- PayAI selected as production facilitator
- PayAI integration proven live
- Mainnet ready / production ready / real payment ready
- Facilitator idempotency proven
- Base-USDC contract compatibility proven
- 0.001 USDC acceptance proven
