# Mocked Mainnet Browser Recovery

This milestone adds a **mainnet-only browser payment controller** and a **local mock browser harness**. It proves the complete browser-facing control flow without MetaMask, a real wallet, a real signature, a production facilitator, Base RPC, real USDC, deployment, or enabling the production mainnet paid route.

## Workerd AJV compatibility repair

Under actual `wrangler dev` / workerd, paid requests previously failed with:

```
Error compiling schema, function code: const schema1 = scope.schema[1]; ...
```

### Offending package / schema

- Package: `@x402/extensions@2.19.0` (`payment-identifier`)
- Call site: `extractAndValidatePaymentIdentifier()` → `validatePaymentIdentifier()`
- Schema: `paymentIdentifierSchema` (JSON Schema Draft 2020-12) attached by `declarePaymentIdentifierExtension(true)`
- Trigger: browser clients echo the extension `schema` field in payment payloads; `@x402/extensions` compiles that schema with AJV on every validation

### Why automated tests previously missed it

- Orchestrator and browser recovery tests built payment payloads **without** the echoed `schema` field, so AJV compilation was never invoked
- Miniflare-based tests run in Node where AJV dynamic code generation succeeds even when schema is present
- Only real workerd (`wrangler dev`) blocks AJV `compile()` during request handling

### Selected repair (Option 1)

First-party mainnet validation now uses `payment-identifier-workerd-safe.ts`, which mirrors the hand-written structural checks in `@x402/extensions` `validatePaymentIdentifier()` and enforces the same `paymentIdentifierSchema` constraints **without runtime JSON Schema compilation**.

Validation remains equivalent:

- required extension declaration
- required payment identifier when server marks it required
- alphanumeric/hyphen/underscore ID format with 16–128 length
- existing mainnet policy checks for network, asset, amount, seller, EIP-712 metadata, authorization structure, settlement receipt, and coordinator idempotency

Runtime dynamic code generation for this path was eliminated. No `eval()`, `new Function()`, or AJV `compile()` runs during paid request handling for payment-identifier validation.

### Mock harness entry path

- Source/dev entry: `src/index.mainnet-mock-harness.ts` (declared in `wrangler.mainnet-mock-harness.toml`)
- Built artifact: `dist-mainnet-mock-harness/index.mainnet-mock-harness.js`
- There is no `dist-mainnet-mock-harness/index.js`; tests fail if that stale path is referenced

### Manual browser proof (workerd)

After the repair, `npx wrangler dev -c wrangler.mainnet-mock-harness.toml` supports:

- **Normal success:** one fake signer, one paid request, one mock verify, one mock settle, success UI, no AJV compile error
- **Response loss:** status polling recovers fulfilled cached result without a second signature or paid request
- **Refresh recovery:** session restores during pending recovery; polling only; no signing or paid request

No external origins (Base RPC, PayAI, Dexter, CDP, x402.org facilitator) are contacted.

## Architecture

The mock harness lives in a separate worker entry (`src/index.mainnet-mock-harness.ts`) and is **not** imported by the production mainnet entry (`src/index.mainnet.ts`).

Browser modules live under `src/mainnet/browser/`:

- `mainnet-pay-controller.ts` — authoritative state machine
- `mainnet-terms-loader.ts` — unpaid 402 validation against immutable mainnet policy
- `mainnet-payment-executor.ts` — one sign, one payment-bearing fetch
- `payment-id-session.ts` — versioned `sessionStorage` recovery
- `pay-status-client.ts` / `pay-status-poller.ts` — read-only status recovery
- `fake-mainnet-signer.ts` — deterministic injected signer (no cryptography)
- `mock-pay-main.ts` — local-only demonstration page wiring

Server-side recovery uses the existing Durable Object coordinator and expands the mainnet status route so `fulfilled` responses may include cached deterministic JSON under `result`.

## Payment identifier lifecycle

1. Load and validate mainnet 402 terms.
2. Generate exactly one `paymentIdentifier` at submit time.
3. Persist it to `sessionStorage` (`x402-mainnet-pending-payment-v1`) before signing.
4. Append it through `@x402/extensions/payment-identifier`.
5. Sign once with the injected fake signer.
6. Send exactly one payment-bearing request.
7. Retain only the payment identifier and safe metadata after uncertain submission.
8. Never generate a replacement identifier for the same attempt.

Session records store only:

- `paymentIdentifier`
- resource input
- paid route identity
- creation time
- submitted / potentially-submitted state

They never store signatures, encoded payment headers, payloads, typed data, wallet addresses, authorization nonces, seller addresses, or facilitator responses.

## One-signature / one-request invariant

The controller enforces:

- at most one fake signer invocation per attempt
- at most one payment-bearing fetch per attempt
- no automatic retries
- no second payment-bearing fetch after status polling begins
- no new payment identifier after submission

Submission controls disable during and after an active attempt.

## Why fulfilled status returns cached output

If the browser loses the original paid HTTP response after the coordinator has already stored the deterministic response, recovery must not require a second signature or payment-bearing request.

For `fulfilled` only, `GET /pay/status/:paymentIdentifier` may return:

```json
{
  "state": "fulfilled",
  "result": {
    "contentType": "application/json",
    "body": { "...": "deterministic cached JSON" }
  }
}
```

The body is parsed JSON from coordinator staged storage only. It is rendered with `textContent` / safe JSON formatting, never injected as HTML. No settlement receipt, complete transaction hash, wallet address, or payment header is exposed.

## Response-loss recovery

When the browser fetch throws after the mock server has fully processed and settled the request:

1. Controller enters `potentially-submitted`.
2. Only the payment identifier and safe metadata remain.
3. Bounded read-only status polling begins.
4. The paid route is never called again.
5. The signer is never invoked again.

On `fulfilled`, the cached deterministic result is rendered and session recovery data is cleared.

## Status polling behavior

Default policy:

- immediate first lookup
- then every 1 second
- maximum 10 automatic polls
- stop on terminal states
- no background polling after Reset

Terminal handling:

- `not_seen` — continue until poll limit, remain potentially-submitted, no auto-resubmit
- in-progress states — continue polling
- `fulfilled` — validate cached result, transition to success, clear session
- `failed-definitive` / `expired` — stop, require Reset and fresh terms
- `uncertain` / malformed — fail closed, no automatic payment action

All status responses use `Cache-Control: no-store`.

## Sanitization

The browser never renders or persists signatures, payment headers, typed data, complete payment identifiers, complete addresses, complete transaction hashes, or raw facilitator / coordinator fields.

## Explicit non-claims

This milestone does **not** verify real mainnet payment, move real USDC, use MetaMask, use a private key, produce a real signature, call a production facilitator, perform Base RPC, deploy infrastructure, or enable the production mainnet paid route.

## Remaining before real facilitator configuration

- Select and review the final production facilitator
- Review immutable mainnet seller / policy configuration
- Wire a real wallet signer path
- Enable the production mainnet paid route deliberately
- Deploy only after the above review is complete

Still without deployment or payment in the next milestone unless explicitly approved.
