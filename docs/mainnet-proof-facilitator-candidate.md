# Mainnet proof facilitator candidate (PayAI)

This document records the **immutable proof facilitator candidate** for one future bounded Base-mainnet payment proof. It does **not** select a production facilitator, enable the mainnet paid route, configure a seller, or authorize real-money use.

## Status terminology

| Term | Value |
| --- | --- |
| Proof facilitator candidate | PayAI |
| Candidate URL | `https://facilitator.payai.network` |
| Proof facilitator status | `candidate-not-live-verified` |
| Production facilitator selected | `false` |
| Mainnet paid route enabled | `false` |
| Mainnet payment readiness | `false` |
| Real-payment compatibility | not yet empirically proven |

PayAI is documented here as a **candidate for a future bounded proof**, not as the permanent or production facilitator.

## Immutable candidate configuration

Source: `src/mainnet/proof-facilitator-candidate.mainnet.ts`

| Field | Value |
| --- | --- |
| Name | PayAI |
| Origin | `https://facilitator.payai.network` |
| Supported path | `/supported` |
| Verify path | `/verify` |
| Settle path | `/settle` |

Production-shaped client factory (not wired into `src/index.mainnet.ts`):

`src/mainnet/proof-facilitator-client.mainnet.ts`

## Official evidence reviewed (2026-07-24)

Primary sources only. Permitted requests: GET / HEAD / OPTIONS. No verify/settle POST, no payment payload, no signature, no Base RPC.

1. **Candidate URL** — PayAI docs and live service use exactly `https://facilitator.payai.network`.
2. **x402 v2 `exact` on `eip155:8453`** — Live `GET /supported` advertises `{ x402Version: 2, scheme: "exact", network: "eip155:8453" }`.
3. **EIP-3009** — PayAI x402 reference documents the exact EVM scheme as EIP-3009 `transferWithAuthorization`.
4. **`HTTPFacilitatorClient`** — PayAI facilitator introduction documents `new HTTPFacilitatorClient(...)` against the PayAI origin.
5. **Free-tier discovery** — PayAI public landing/docs describe starting without merchant API keys for facilitator discovery; merchant JWT auth is documented for production merchant flows, not required to read `/supported`.
6. **Documented paths** — `/verify`, `/settle`, and `/supported` are the documented facilitator REST paths.
7. **Native Base USDC contract** — PayAI `/supported` advertises network/scheme kinds only; it does **not** directly advertise native Base USDC contract `0x833589…` support.
8. **Amount `"1000"`** — Not empirically tested against PayAI in this repository.
9. **Production behavior** — Remains unproven until a separate controlled real-payment task authorizes it.

Local evidence snapshots may be stored in ignored `payai-supported.json`; tracked source keeps only the immutable candidate constants above.

## Current runtime posture

- `src/index.mainnet.ts` keeps `GET /v1/example` at `503 NOT_ENABLED`.
- Orchestrator tests and mock harnesses inject `createMockFacilitatorClient()` only.
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
