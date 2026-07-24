# Base Sepolia Browser Payment Proof

> **PUBLIC-SAFE REDACTED TEST EVIDENCE**
>
> This record describes a supervised Base Sepolia browser payment performed outside the public repository. Exact deployment hostname, account identity, and on-chain references were intentionally omitted from the tracked source. Public readers cannot reproduce the historical payment against the omitted deployment.

> **Source-template proof only.** This record applies to the dedicated demonstration Worker `x402-worker-template-testnet` built from this repository. A copied or renamed clone does **not** inherit this verification unless it completes its own supervised proof. Do not point clone documentation at this file as proof of clone payment.

## 1. Scope

This document records the first verified browser MetaMask payment against the dedicated demonstration Worker `x402-worker-template-testnet` on Base Sepolia testnet.

It distinguishes:

- **Directly observed evidence** from the supervised live run
- **Balance evidence** from read-only token balance checks
- **Code-enforced guarantees** from the browser payment implementation
- **Information not captured** during the live run

## 2. Deployed Worker identity

| Field | Value |
| --- | --- |
| Worker name | `x402-worker-template-testnet` |
| Public URL | intentionally omitted — documented placeholder: `<testnet-worker-url>` |
| Proof date | 2026-07-23 |

The exact Workers hostname and Cloudflare account identity were intentionally omitted from the public repository.

The river reference Worker (`x402-usgs-river-snapshot`) was not modified.

## 3. Source commit

Deployed browser bundle source:

- `2a0c44d` — Fix browser fetch receiver binding

Earlier payment-flow commits on the same branch:

- `750f1b9` — Add hard-gated MetaMask payment flow
- `4148d6a` — Fix gitignore regression test for archive checkouts

## 4. Exact payment policy

| Field | Value |
| --- | --- |
| Network | Base Sepolia (`eip155:84532`, chain ID `84532`) |
| Token | Base Sepolia test USDC |
| Atomic amount | `1000` |
| Display amount | `0.001 test USDC` |
| Paid route | `GET /v1/example?value=browser-demo` |
| Scheme | `exact` |
| EIP-712 domain | `USDC` / `2` |
| Timeout | `300` seconds |
| Payment options | exactly one |

Mainnet and real USDC were not tested.

## 5. Manual confirmation sequence

**Directly observed:**

1. Opened deployed `/pay` after hard refresh (required once because a cached older `/pay.js` still contained the detached-fetch bug).
2. Confirmed prominent **BASE SEPOLIA TESTNET** banner.
3. Connected the existing buyer MetaMask account.
4. Confirmed MetaMask network Base Sepolia (chain ID `84532`).
5. Loaded and validated payment terms for `/v1/example` input `browser-demo`.
6. Reviewed the final confirmation panel showing one testnet payment attempt.
7. Clicked **Sign and Submit One Testnet Payment** exactly once.
8. Approved exactly one MetaMask typed-data request.

**MetaMask displayed (directly observed):**

- Base Sepolia Testnet
- `TransferWithAuthorization`
- Correct Base Sepolia test-USDC contract
- Buyer as **From**
- Seller as **To**
- Value `1000`

No second user authorization occurred. No retry was performed.

## 6. Buyer and seller balance evidence

**Balance evidence (numeric only):**

| Account | Pre-payment | Post-payment | Change |
| --- | ---: | ---: | ---: |
| Buyer | 0.998 test USDC | 0.997 test USDC | −0.001 test USDC |
| Seller | 0.002 test USDC | 0.003 test USDC | +0.001 test USDC |

Buyer and seller are separate accounts.

## 7. Result

**Directly observed:**

- Payment page reached terminal state `success`.
- Paid API response corresponded to input `browser-demo`.

**Balance evidence:**

- Buyer decreased by exactly `0.001` test USDC.
- Seller increased by exactly `0.001` test USDC.

**Information not captured:**

- No transaction hash was recorded.
- No block number, gas cost, raw settlement header, or browser Network-panel request count was independently logged.

## 8. Duplicate-payment protections

**Code-enforced guarantees (implementation):**

- Bound in-memory quote passed directly to `createPaymentPayload` without a second unpaid 402 fetch after confirmation.
- Quote marked consumed before signing begins.
- `pendingAction` blocks double-click signing and submission.
- `paymentAttemptCompleted` blocks another attempt until Reset and fresh terms load.
- No automatic retry on uncertain submission.
- Payment-bearing fetch uses `redirect: "error"` with no application-level retry.
- SDK `recovered: true` paths fail closed in the browser executor.

The implementation enforces **at most one** typed-data signature request and **at most one** payment-bearing HTTP request per explicit user click. The repository does not contain durable runtime telemetry proving the actual Network-panel request count from the live browser session.

**Directly observed:**

- Exactly one visible MetaMask signature prompt was approved.
- No second payment was attempted.

## 9. Information deliberately not recorded

This proof intentionally excludes:

- Complete buyer or seller addresses
- Private keys or seed phrases
- Signature bytes
- Typed-data payload
- Payment authorization
- Payment header
- Raw settlement header
- Transaction hash (none recorded)
- Real Workers hostname or Cloudflare account identity
- Browser Network-panel captures

## 10. Remaining limitations

- **Browser payment verified on Base Sepolia** — yes, for the dedicated demonstration Worker on 2026-07-23.
- **Mainnet not tested**
- **Real USDC not tested**
- **Template publication** — sanitized history, Apache-2.0 license, dependency pinning, CI, and canonical repository metadata are complete; initial public push to https://github.com/minerstms/x402-worker-template is authorized.
- **No customer private key required** for browser customers.
- A hard refresh was once required after redeploy because browsers could retain a stale `/pay.js` until cache headers were hardened.
- Post-success UI initially showed `Payment terms: awaiting confirmation` while wallet state was `success`; this was corrected in a follow-up patch.

## Status summary

| Milestone | Status |
| --- | --- |
| Node CLI Base Sepolia payment | Verified (river reference origin) |
| Browser MetaMask Base Sepolia payment | Verified 2026-07-23 |
| Mainnet | Unsupported |
| Real USDC | Not tested |
| Public-release ready | Not yet |
| Another live payment | Not required for this milestone |
