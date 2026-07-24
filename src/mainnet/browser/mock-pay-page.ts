export const MOCK_PAY_CONTENT_SECURITY_POLICY =
  "default-src 'none'; script-src 'self'; style-src 'self'; connect-src 'self'; img-src 'self'; font-src 'none'; object-src 'none'; base-uri 'none'; form-action 'none'; frame-ancestors 'none';";

export function buildMockPayPageHtml(): string {
  return `<!DOCTYPE html>
<html lang="en">
  <head>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1" />
    <title>Simulated Mainnet x402 Payment</title>
    <link rel="stylesheet" href="/mock-pay.css" />
  </head>
  <body>
    <main>
      <header class="panel">
        <h1>Simulated Mainnet x402 Payment</h1>
        <p class="banner warning">SIMULATED MAINNET PAYMENT — NO REAL MONEY</p>
        <p class="muted">Local mock harness only. Uses a deterministic fake signer, mocked facilitator, and Durable Object coordinator. No wallet, no real signature, and no external requests.</p>
      </header>

      <section class="panel" aria-labelledby="mode-heading">
        <h2 id="mode-heading">Simulation mode</h2>
        <label for="simulation-mode">Choose a deterministic local mode</label>
        <select id="simulation-mode">
          <option value="normal-success">Normal success</option>
          <option value="response-loss">Response lost after settlement</option>
          <option value="verify-delayed">Verify delayed</option>
          <option value="settle-delayed">Settle delayed</option>
          <option value="verify-definitive-failure">Verify definitive failure</option>
          <option value="settle-definitive-failure">Settle definitive failure</option>
          <option value="verify-timeout">Verify timeout</option>
          <option value="settle-timeout">Settle timeout</option>
          <option value="malformed-settlement">Malformed settlement receipt</option>
        </select>
      </section>

      <section class="panel" aria-labelledby="state-heading">
        <h2 id="state-heading">Current state</h2>
        <dl>
          <dt>Controller state</dt>
          <dd id="controller-state">idle</dd>
          <dt>Payment ID</dt>
          <dd id="payment-id-display">not generated</dd>
          <dt>Signing count</dt>
          <dd id="signing-count">0</dd>
          <dt>Payment-bearing requests</dt>
          <dd id="paid-request-count">0</dd>
          <dt>Status polls</dt>
          <dd id="status-poll-count">0</dd>
        </dl>
      </section>

      <section class="panel" aria-labelledby="terms-heading">
        <h2 id="terms-heading">Mainnet terms</h2>
        <dl>
          <dt>Route</dt>
          <dd>/v1/example</dd>
          <dt>Input</dt>
          <dd id="input-value">hello</dd>
          <dt>Price</dt>
          <dd>0.001 USDC (simulated)</dd>
          <dt>Network</dt>
          <dd>eip155:8453 (simulated)</dd>
        </dl>
      </section>

      <section class="panel controls" aria-labelledby="actions-heading">
        <h2 id="actions-heading">Actions</h2>
        <button id="load-terms" type="button">Load and Validate Mainnet Terms</button>
        <button id="sign-and-submit" type="button" disabled>Sign Once and Submit Simulated Payment</button>
        <button id="reset" class="secondary" type="button">Reset</button>
      </section>

      <section id="result-panel" class="panel hidden" aria-live="polite"></section>
      <p id="status" class="status panel" role="status" aria-live="polite"></p>
    </main>
    <script src="/mock-pay.js" defer></script>
  </body>
</html>`;
}
