# Security Policy

## Supported scope

This repository is a **template and test harness** for x402 payments on **Base Sepolia testnet** only.

- Production Base mainnet paid routes remain **disabled** in the tracked configuration.
- No production facilitator, seller wallet, or deployment identity is configured in the public source tree.
- Real mainnet payment, real USDC movement, and production deployment require deliberate, supervised steps outside the default template state.

## Reporting a vulnerability

If you believe you have found a security issue in this repository:

1. **Do not** open a public issue with exploit details, credentials, or live payment reproduction steps.
2. Contact the repository maintainer through a private channel agreed with the project owner.
3. Include a concise description, affected paths or commits, and minimal reproduction notes without private keys, signatures, or payment headers.

Public issues may be used for general hardening discussions that do not expose sensitive material.

## Sensitive material

Never commit or paste into issues:

- Private keys, seed phrases, or wallet files
- `.dev.vars`, `.env.buyer`, or other local secret files
- Payment signatures, authorization payloads, or raw settlement headers
- Complete buyer/seller addresses tied to live funds
- Cloudflare API tokens, account IDs, or credential-bearing URLs
- HAR captures, browser logs, or audit dumps containing authorization material

The tracked `.gitignore` is designed to keep these classes of files local.

## Security expectations for adopters

Before enabling payment on any deployed Worker:

- Configure seller addresses and secrets only through ignored local files or Cloudflare secrets — never in Git.
- Keep `syncFacilitatorOnStart: false` unless you have reviewed facilitator behavior deliberately.
- Treat uncertain payment outcomes as fail-closed; do not auto-retry signing or settlement.
- Review mainnet architecture docs before any future mainnet experiment; production mainnet remains disabled by default here.

## Dependency integrity

Direct dependencies are pinned in `package.json`. CI verifies `npm ci`, tests, typechecks, builds, and a clean `git archive` checkout. Upgrade `@x402/*` packages only after reviewing workerd-safe validator parity tests and payment-state invariants.

## Out of scope for this template

- Operating a production payment service
- Custody of user wallets or private keys
- Guaranteeing facilitator availability or pricing
- Mainnet readiness claims
