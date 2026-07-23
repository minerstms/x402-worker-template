import type { Context } from "hono";
import type { ResolvedConfig } from "../config.js";
import { buildPayPublicConfig } from "../pay-public-config.js";
import { PAY_CSS, PAY_JS } from "../generated/pay-assets.js";

export const PAY_CONTENT_SECURITY_POLICY =
  "default-src 'none'; script-src 'self'; style-src 'self'; connect-src 'self'; img-src 'self'; font-src 'none'; object-src 'none'; base-uri 'none'; form-action 'none'; frame-ancestors 'none';";

export function buildPayPageHtml(): string {
  return `<!DOCTYPE html>
<html lang="en">
  <head>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1" />
    <title>x402 Worker Payment Demo</title>
    <link rel="stylesheet" href="/pay.css" />
  </head>
  <body>
    <main>
      <header class="panel">
        <h1>x402 Worker Payment Demo</h1>
        <p class="banner">BASE SEPOLIA TESTNET — No real money. No automatic renewal. One request only.</p>
        <p class="muted">This page validates Base Sepolia payment terms and supports one explicit MetaMask signature plus one payment request when a real seller is configured.</p>
      </header>

      <section class="panel" aria-labelledby="state-heading">
        <h2 id="state-heading">Current state</h2>
        <dl>
          <dt>Wallet</dt>
          <dd id="wallet-state">wallet-unavailable</dd>
          <dt>Account</dt>
          <dd id="account-display">not connected</dd>
          <dt>Network</dt>
          <dd id="network-state">unknown</dd>
          <dt>Payment terms</dt>
          <dd id="validation-state">not loaded</dd>
          <dt>Seller configuration</dt>
          <dd id="seller-state">unknown</dd>
        </dl>
      </section>

      <section class="panel" aria-labelledby="service-heading">
        <h2 id="service-heading">Requested service</h2>
        <dl>
          <dt>Service</dt>
          <dd>/v1/example</dd>
          <dt>Input</dt>
          <dd>browser-demo</dd>
          <dt>Price</dt>
          <dd>0.001 test USDC</dd>
          <dt>Seller</dt>
          <dd id="seller-display">unknown</dd>
        </dl>
      </section>

      <section class="panel controls" aria-labelledby="actions-heading">
        <h2 id="actions-heading">Actions</h2>
        <button id="connect-wallet" type="button">Connect Wallet</button>
        <button id="switch-network" type="button">Switch to Base Sepolia</button>
        <button id="load-terms" type="button">Load and Validate Payment Terms</button>
        <button id="review-payment" class="secondary" type="button">Review Final Payment Confirmation</button>
        <button id="sign-and-submit" type="button" disabled>Sign and Submit One Testnet Payment</button>
        <button id="reset" class="secondary" type="button">Reset</button>
      </section>

      <section id="summary-panel" class="panel hidden" aria-labelledby="summary-heading">
        <h2 id="summary-heading">Payment summary</h2>
        <ul id="summary-list" class="summary-list"></ul>
      </section>

      <section id="confirmation-panel" class="panel hidden banner" aria-labelledby="confirmation-heading">
        <h2 id="confirmation-heading">Final confirmation</h2>
        <ul class="summary-list">
          <li>BASE SEPOLIA TESTNET</li>
          <li>0.001 test USDC</li>
          <li>Service: /v1/example</li>
          <li>Input: browser-demo</li>
          <li>Token verified</li>
          <li>Seller verified</li>
          <li>Network verified</li>
          <li>EIP-712 domain verified</li>
          <li>Timeout verified</li>
          <li>Exactly one payment option</li>
          <li>No subscription</li>
          <li>No automatic renewal</li>
          <li>One request only</li>
          <li>One wallet signature will be requested</li>
          <li>This authorizes a testnet token transfer</li>
        </ul>
      </section>

      <section id="result-panel" class="panel hidden" aria-live="polite"></section>

      <p id="status" class="status panel" role="status" aria-live="polite"></p>
    </main>
    <script src="/pay.js" defer></script>
  </body>
</html>`;
}

export function createPayConfigHandler(config: ResolvedConfig) {
  return (c: Context) => {
    return c.json(buildPayPublicConfig(config), 200, {
      "Cache-Control": "no-store",
    });
  };
}

export function payPageHandler(c: Context) {
  const html = buildPayPageHtml();
  return c.html(html, 200, {
    "Content-Security-Policy": PAY_CONTENT_SECURITY_POLICY,
    "Cache-Control": "no-store",
  });
}

export function payJsHandler(c: Context) {
  return c.body(PAY_JS, 200, {
    "Content-Type": "application/javascript; charset=utf-8",
    "Cache-Control": "no-store",
  });
}

export function payCssHandler(c: Context) {
  return c.body(PAY_CSS, 200, {
    "Content-Type": "text/css; charset=utf-8",
    "Cache-Control": "no-store",
  });
}
