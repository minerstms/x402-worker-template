import { decodePaymentResponseHeader } from "@x402/core/http";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { MAINNET_NETWORK } from "../src/mainnet/payment-policy.mainnet.js";
import {
  buildTestPaymentPayload,
  createProofFacilitatorOrchestratorContext,
  dispatchMainnetPaidRequest,
  dispatchMainnetUnpaidRequest,
  MAINNET_TEST_PAYMENT_ID,
  MAINNET_TEST_QUERY_VALUE,
} from "./helpers/mainnet-orchestrator-harness.js";
import { coordinatorGetStatusByPaymentIdentifier } from "./helpers/mainnet-coordinator-harness.js";
import { installNetworkGuard } from "./helpers/mock-facilitator.js";
import { countLedgerOperations } from "./helpers/proof-facilitator-mock-fetch.js";

const ROOT = join(import.meta.dirname, "..");

describe("PayAI proof facilitator orchestrator integration", () => {
  let restoreFetch: () => void;

  beforeEach(() => {
    restoreFetch = installNetworkGuard();
  });

  afterEach(() => {
    restoreFetch();
    vi.restoreAllMocks();
  });

  it("fulfills once through injected adapter transport", async () => {
    const { deps, ledger, bindings, dispose } = await createProofFacilitatorOrchestratorContext();
    const unpaid = await dispatchMainnetUnpaidRequest(deps);
    expect(unpaid.status).toBe(402);
    expect(countLedgerOperations(ledger, "verify")).toBe(0);
    expect(countLedgerOperations(ledger, "settle")).toBe(0);

    const paid = await dispatchMainnetPaidRequest(deps);
    expect(paid.status).toBe(200);
    expect(countLedgerOperations(ledger, "verify")).toBe(1);
    expect(countLedgerOperations(ledger, "settle")).toBe(1);
    expect(await paid.json()).toEqual({
      success: true,
      service: "x402 Worker Template",
      input: { value: MAINNET_TEST_QUERY_VALUE },
      output: { value: MAINNET_TEST_QUERY_VALUE },
    });
    const status = await coordinatorGetStatusByPaymentIdentifier(
      bindings.PAYMENT_COORDINATOR,
      MAINNET_TEST_PAYMENT_ID,
    );
    expect(status?.state).toBe("fulfilled");
    await dispose();
  });

  it("replays cached fulfillment without new verify or settle requests", async () => {
    const { deps, ledger, resetLedger, dispose } = await createProofFacilitatorOrchestratorContext();
    await dispatchMainnetPaidRequest(deps);
    resetLedger();
    const replay = await dispatchMainnetPaidRequest(
      deps,
      await buildTestPaymentPayload(deps),
    );
    expect(replay.status).toBe(200);
    expect(countLedgerOperations(ledger, "verify")).toBe(0);
    expect(countLedgerOperations(ledger, "settle")).toBe(0);
    await dispose();
  });

  it("marks settle uncertainty without a second settlement request", async () => {
    const { deps, ledger, bindings, dispose } = await createProofFacilitatorOrchestratorContext({
      mockFetch: { settleResponse: "throw-timeout" },
    });
    const first = await dispatchMainnetPaidRequest(deps);
    expect(first.status).toBe(503);
    expect(countLedgerOperations(ledger, "verify")).toBe(1);
    expect(countLedgerOperations(ledger, "settle")).toBe(1);
    const statusAfterFirst = await coordinatorGetStatusByPaymentIdentifier(
      bindings.PAYMENT_COORDINATOR,
      MAINNET_TEST_PAYMENT_ID,
    );
    expect(statusAfterFirst?.state).toBe("uncertain");

    const second = await dispatchMainnetPaidRequest(deps, await buildTestPaymentPayload(deps));
    expect(second.status).toBe(503);
    expect(countLedgerOperations(ledger, "settle")).toBe(1);
    expect(JSON.stringify(await second.json())).not.toContain(MAINNET_TEST_PAYMENT_ID);
    await dispose();
  });

  it("returns official PAYMENT-RESPONSE on successful adapter settlement", async () => {
    const { deps, dispose } = await createProofFacilitatorOrchestratorContext();
    const res = await dispatchMainnetPaidRequest(deps);
    const header = res.headers.get("PAYMENT-RESPONSE");
    expect(header).toBeTruthy();
    const decoded = decodePaymentResponseHeader(header!);
    expect(decoded.success).toBe(true);
    expect(decoded.network).toBe(MAINNET_NETWORK);
    await dispose();
  });
});

describe("PayAI proof facilitator production bundle egress", () => {
  it("keeps PayAI as the only facilitator origin when candidate config appears", () => {
    const bundle = readFileSync(join(ROOT, "dist-mainnet/index.mainnet.js"), "utf8");
    const facilitatorOrigins = [
      "https://facilitator.payai.network",
      "https://x402.org/facilitator",
      "https://facilitator.cdp.coinbase.com",
      "https://facilitator.dexter.cash",
    ];
    const present = facilitatorOrigins.filter((origin) => bundle.includes(origin));
    if (present.length > 0) {
      expect(present).toEqual(["https://facilitator.payai.network"]);
    }
    expect(bundle).not.toContain("https://x402.org/facilitator");
    expect(bundle).not.toContain("facilitator.cdp.coinbase.com");
    expect(bundle).not.toContain("facilitator.dexter");
    expect(bundle).not.toContain("HTTPFacilitatorClient");
    expect(bundle).not.toContain("createProofFacilitatorCandidateHttpClient");
    expect(bundle).not.toContain("mock-facilitator-client");
  });

  it("keeps production entry disabled without facilitator wiring", () => {
    const source = readFileSync(join(ROOT, "src/index.mainnet.ts"), "utf8");
    expect(source).toContain('code: "NOT_ENABLED"');
    expect(source).not.toContain("createProofFacilitatorCandidateHttpClient");
    expect(source).not.toContain("HTTPFacilitatorClient");
    expect(source).not.toContain("proof-facilitator-client");
  });
});
