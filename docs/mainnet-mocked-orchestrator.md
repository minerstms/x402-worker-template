# Mainnet mocked payment orchestrator

This patch adds a **mainnet-only manual x402 payment orchestration pipeline** that runs entirely against an injected in-memory mock facilitator. No production facilitator, seller wallet, or Base RPC endpoint is configured.

## Mainnet policy values

| Field | Value |
| --- | --- |
| Scheme | `exact` |
| Network | `eip155:8453` |
| Chain ID | `8453` / `0x2105` |
| Asset | Native Base USDC `0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913` |
| Amount | `"1000"` (0.001 USDC, 6 decimals) |
| EIP-712 | `USD Coin` / `2` |
| Timeout | `300` seconds |
| Route | `GET /v1/example?value=…` |
| Payment identifier | **required** extension |
| Seller | Injected test input only (dead placeholder in tests) |

Policy module: `src/mainnet/payment-policy.mainnet.ts`

## Manual pre-verify pipeline

The orchestrator (`src/mainnet/idempotency/mainnet-payment-orchestrator.ts`) performs these steps **without** `paymentMiddlewareFromHTTPServer` or `processHTTPRequest()`:

1. Decode `PAYMENT-SIGNATURE`
2. Build server requirements from `src/mainnet/payment.mainnet.ts`
3. Match exactly one server requirement (`findMatchingRequirements`)
4. Validate extension echo (`validateExtensions`)
5. Validate required payment identifier (before coordinator reservation)
6. Structurally validate EIP-3009 authorization (before reservation)
7. Compute canonical keys from **matched server requirement**
8. `prepareAttempt` on the durable coordinator
9. Verify lease → `verifyPayment` exactly once
10. Stage deterministic JSON response
11. Settle lease → `settlePayment` exactly once
12. Validate settlement receipt → `completeFulfillment` with up to three local retries
13. Return staged body + official `PAYMENT-RESPONSE`

Buyer `accepted` fields are never treated as canonical server terms.

## Matched-requirement trust boundary

Terms fingerprint, auth commitment, and resource identity hash are derived from the **server-matched** requirement and request context. Substituted buyer amount, seller, token, or network are rejected before reservation.

## Coordinator lease sequence

`reserved → verifying → verified → computing → settling → fulfilled`

- Verify/settle leases are acquired through the durable coordinator client.
- Uncertain verify/settle results preserve operation generation/token; no automatic re-verify or re-settle.
- Fulfilled duplicates replay cached body and reconstructed `PAYMENT-RESPONSE` without facilitator calls.

## Mock facilitator scope

Test helper: `test/helpers/mock-facilitator.ts`

Supported deterministic modes: verify/settle success, definitive failure, thrown timeout, delayed operations, malformed settlement receipt. Call counts are tracked; `fetch()` is blocked by a network guard in orchestrator tests.

## Failure and uncertainty handling

| Case | HTTP | Coordinator |
| --- | --- | --- |
| Pre-reservation invalid payload | 402 | No record |
| Coordinator conflict | 409 | unchanged |
| Verify/settle definitive failure | 402 | `failed-definitive` |
| Verify/settle timeout/unknown | 503 (fail-closed) | `uncertain` |
| In-progress duplicate | 202 | wait (no verify/settle) |

## Production mainnet entry remains disabled

`src/index.mainnet.ts` exposes only:

- `/health`
- `/pay/status/:paymentIdentifier`
- `/v1/example` → `503 NOT_ENABLED`

The orchestrator is reachable **only** through tests and the non-production harness helpers under `test/helpers/`.

## Confirmations

- No production facilitator URL is configured.
- No real seller address is configured in Wrangler.
- No wallet, signature, Base RPC call, deployment, or Cloudflare resource was created for this patch.

## Next step

Integrate the mainnet browser payment identifier and status polling against the mock harness only (still no production facilitator or enabled paid route).
