# Disabled mainnet proof deployment

This document describes the **inert Cloudflare Worker** used for a future bounded Base-mainnet payment proof. It does **not** enable payments, select a production facilitator, or activate a production seller.

## Worker

| Field | Value |
| --- | --- |
| Wrangler config | `wrangler.mainnet-proof-disabled.toml` |
| Worker name | `x402-worker-template-mainnet-proof-disabled` |
| Entry | `src/index.mainnet.ts` (paid route returns **503 `NOT_ENABLED`**) |
| Public URL | `workers.dev` only (`workers_dev = true`) |
| Custom routes / domains | **none** |

## Seller secret binding

| Term | Meaning |
| --- | --- |
| Dedicated proof seller binding | A Cloudflare secret named `MAINNET_SELLER_ADDRESS` may be supplied at **upload/deploy** time |
| Seller address in Git | **never** |
| Seller address exposed publicly | **never** (not returned by HTTP responses in disabled mode) |
| Production seller activated | **false** — runtime code does not consume the secret for payment requirements or settlement |
| Production seller selected | **false** |

The secret name is documented in Wrangler comments and `MAINNET_PROOF_SELLER_SECRET_NAME` in source. The **value** is loaded only from a local file outside Git and uploaded through Wrangler `--secrets-file`.

## Status terminology (unchanged safety posture)

| Term | Value |
| --- | --- |
| PayAI proof facilitator candidate | PayAI (`candidate-not-live-verified`) |
| Production facilitator selected | `false` |
| Production mainnet route enabled | `false` |
| Payment ready | `false` |
| Real Base-mainnet payment | **not completed** |

Do **not** interpret deployment of this disabled Worker as:

- Production seller configured in source
- Mainnet ready / payment ready
- PayAI live compatibility proven
- Seller settlement proven

## Authorized Cloudflare resources

Only:

- The Worker script/version
- The `PaymentCoordinatorDurableObject` Durable Object binding already declared in the reviewed mainnet configuration

No D1, R2, KV, Queue, Vectorize, AI, Browser, service bindings, custom routes, or custom domains.

## Upload procedure (operational)

1. Validate a dedicated empty seller address from a local file **outside Git**
2. Create a temporary `.env` file under `%TEMP%` with `MAINNET_SELLER_ADDRESS=<address>`
3. Upload a non-serving version: `wrangler versions upload -c wrangler.mainnet-proof-disabled.toml --secrets-file <temp.env>`
4. Verify preview URL returns **503 `NOT_ENABLED`** for `/v1/example`
5. Deploy the exact reviewed version at 100% with `wrangler versions deploy`

Never commit the address, print it in logs, or place it in `[vars]`.
