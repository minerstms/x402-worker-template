/// <reference path="../worker-configuration.mainnet.d.ts" />

import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it, vi, beforeEach, afterEach } from "vitest";
import { encodePaymentRequiredHeader } from "@x402/core/http";
import type { PaymentRequired } from "@x402/core/types";
import {
  PAYMENT_IDENTIFIER,
  extractAndValidatePaymentIdentifier,
} from "@x402/extensions/payment-identifier";
import { MainnetPayController } from "../src/mainnet/browser/mainnet-pay-controller.js";
import {
  executeMainnetPaymentAttempt,
  readExecutorSensitiveSnapshot,
} from "../src/mainnet/browser/mainnet-payment-executor.js";
import {
  loadAndValidateMainnetTerms,
  buildMainnetPaidRouteUrl,
} from "../src/mainnet/browser/mainnet-terms-loader.js";
import {
  MAINNET_PENDING_PAYMENT_SESSION_KEY,
  MAINNET_SESSION_MAX_AGE_MS,
  readPendingMainnetPaymentSession,
  savePendingMainnetPaymentSession,
} from "../src/mainnet/browser/payment-id-session.js";
import { fetchPaymentStatus } from "../src/mainnet/browser/pay-status-client.js";
import {
  pollPaymentStatus,
  type TimerScheduler,
} from "../src/mainnet/browser/pay-status-poller.js";
import { createFakeMainnetSigner, FAKE_MAINNET_SIGNATURE } from "../src/mainnet/browser/fake-mainnet-signer.js";
import { formatPaidApiText } from "../src/browser/pay-receipt.js";
import { containsPrivateData } from "../src/browser/sanitize-error.js";
import {
  BASE_SEPOLIA_NETWORK,
  BASE_USDBC_ASSET,
  MAINNET_CHAIN_ID_DECIMAL,
  MAINNET_USDC_EIP712_NAME,
  MAINNET_USDC_EIP712_VERSION,
  rejectNonMainnetPaymentTerms,
} from "../src/mainnet/payment-policy.mainnet.js";
import { declarePaymentIdentifierExtension } from "@x402/extensions/payment-identifier";
import {
  buildMatchedMainnetRequirement,
  createMainnetOrchestratorContext,
  dispatchMainnetUnpaidRequest,
  MAINNET_TEST_QUERY_VALUE,
  MAINNET_TEST_SELLER,
} from "./helpers/mainnet-orchestrator-harness.js";
import {
  createMainnetBrowserFetchHarness,
  createMemorySessionStorage,
} from "./helpers/mainnet-browser-harness.js";
import { installNetworkGuard } from "./helpers/mock-facilitator.js";

const projectRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

function build402Response(paymentRequired: PaymentRequired, status = 402): Response {
  return new Response(JSON.stringify(paymentRequired), {
    status,
    headers: {
      "PAYMENT-REQUIRED": encodePaymentRequiredHeader(paymentRequired),
      "Content-Type": "application/json",
    },
  });
}

function buildValidMainnetPaymentRequired(): PaymentRequired {
  return {
    x402Version: 2,
    resource: {
      url: buildMainnetPaidRouteUrl("http://localhost", MAINNET_TEST_QUERY_VALUE),
      mimeType: "application/json",
    },
    accepts: [buildMatchedMainnetRequirement()],
    extensions: {
      [PAYMENT_IDENTIFIER]: declarePaymentIdentifierExtension(true),
    },
  };
}

function createFakeScheduler(): TimerScheduler & { runAll: () => void } {
  const timers: Array<{ fn: () => void; at: number }> = [];
  let nowMs = 0;
  return {
    now: () => nowMs,
    setTimeout(fn, ms) {
      if (ms <= 0) {
        queueMicrotask(fn);
        return timers.length + 1;
      }
      timers.push({ fn, at: nowMs + ms });
      return timers.length;
    },
    clearTimeout(handle) {
      timers.splice(Number(handle) - 1, 1);
    },
    runAll() {
      while (timers.length > 0) {
        timers.sort((a, b) => a.at - b.at);
        const next = timers.shift()!;
        nowMs = next.at;
        next.fn();
      }
    },
  };
}

describe("mainnet mocked browser recovery flow", () => {
  let restoreFetch: () => void;

  beforeEach(() => {
    restoreFetch = installNetworkGuard();
  });

  afterEach(() => {
    restoreFetch();
    vi.restoreAllMocks();
  });

  it("1-5 terms loader accepts mock 402 and rejects invalid mainnet terms", async () => {
    const validRequired = buildValidMainnetPaymentRequired();
    const validFetch = vi.fn(async () => build402Response(validRequired));
    const accepted = await loadAndValidateMainnetTerms({
      fetchImpl: validFetch,
      origin: "http://localhost",
      policy: { sellerAddress: MAINNET_TEST_SELLER },
    });
    expect(accepted.ok).toBe(true);

    const sepoliaRequired: PaymentRequired = {
      ...validRequired,
      accepts: [{ ...buildMatchedMainnetRequirement(), network: BASE_SEPOLIA_NETWORK }],
    };
    const sepolia = await loadAndValidateMainnetTerms({
      fetchImpl: vi.fn(async () => build402Response(sepoliaRequired)),
      origin: "http://localhost",
      policy: { sellerAddress: MAINNET_TEST_SELLER },
    });
    expect(sepolia.ok).toBe(false);

    const wrongToken = {
      ...validRequired,
      accepts: [
        {
          ...buildMatchedMainnetRequirement(),
          asset: BASE_USDBC_ASSET,
        },
      ],
    };
    expect(
      rejectNonMainnetPaymentTerms(wrongToken.accepts[0]!, MAINNET_TEST_SELLER),
    ).toContain("USDbC");

    const wrongName = {
      ...validRequired,
      accepts: [
        {
          ...buildMatchedMainnetRequirement(),
          extra: { name: "USDC", version: MAINNET_USDC_EIP712_VERSION },
        },
      ],
    };
    const wrongNameResult = await loadAndValidateMainnetTerms({
      fetchImpl: vi.fn(async () => build402Response(wrongName)),
      origin: "http://localhost",
      policy: { sellerAddress: MAINNET_TEST_SELLER },
    });
    expect(wrongNameResult.ok).toBe(false);

    const missingIdentifier = { ...validRequired, extensions: {} };
    const missingIdResult = await loadAndValidateMainnetTerms({
      fetchImpl: vi.fn(async () => build402Response(missingIdentifier)),
      origin: "http://localhost",
      policy: { sellerAddress: MAINNET_TEST_SELLER },
    });
    expect(missingIdResult.ok).toBe(false);
  });

  it("6-16 payment identifier lifecycle, fake signer, and sensitive clearing", async () => {
    const harness = await createMainnetBrowserFetchHarness();
    const signer = createFakeMainnetSigner();
    const storage = createMemorySessionStorage();
    const controller = new MainnetPayController({
      origin: harness.origin,
      policy: { sellerAddress: MAINNET_TEST_SELLER },
      fetchImpl: harness.fetchImpl,
      sessionStorage: storage,
      signer,
    });

    expect(controller.snapshot.paymentIdentifier).toBeNull();
    await controller.loadTerms();
    expect(controller.snapshot.uiState).toBe("ready");
    expect(controller.snapshot.paymentIdentifier).toBeNull();

    await controller.submitPayment("normal");
    const paymentIdentifier = controller.snapshot.paymentIdentifier;
    expect(typeof paymentIdentifier).toBe("string");
    expect(paymentIdentifier).toMatch(/^pay_/);
    expect(signer.recorder.invocationCount).toBe(1);
    expect(signer.recorder.lastDomain?.chainId).toBe(MAINNET_CHAIN_ID_DECIMAL);
    expect(signer.recorder.lastDomain?.verifyingContract).toBe(
      "0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913",
    );
    expect(signer.recorder.lastDomain?.name).toBe(MAINNET_USDC_EIP712_NAME);
    expect(signer.recorder.lastDomain?.version).toBe(MAINNET_USDC_EIP712_VERSION);
    expect(String(signer.recorder.lastMessage?.value)).toBe("1000");
    expect(signer.recorder.lastMessage?.to).toBe(MAINNET_TEST_SELLER);

    const terms = controller.snapshot.terms!;
    const execution = await executeMainnetPaymentAttempt({
      fetchImpl: harness.fetchImpl,
      signer: createFakeMainnetSigner(),
      policy: { sellerAddress: MAINNET_TEST_SELLER },
      terms,
      paymentIdentifier: "pay_testidentifier01",
    });
    expect(execution.ok).toBe(true);
    await harness.dispose();
  });

  it("17-19 normal success clears session and disables another submission", async () => {
    const harness = await createMainnetBrowserFetchHarness();
    const storage = createMemorySessionStorage();
    const controller = new MainnetPayController({
      origin: harness.origin,
      policy: { sellerAddress: MAINNET_TEST_SELLER },
      fetchImpl: harness.fetchImpl,
      sessionStorage: storage,
    });
    await controller.loadTerms();
    await controller.submitPayment("normal");
    expect(controller.snapshot.uiState).toBe("success");
    expect(storage.getItem(MAINNET_PENDING_PAYMENT_SESSION_KEY)).toBeNull();
    expect(controller.canSubmit()).toBe(false);
    await harness.dispose();
  });

  it("20-28 response-loss retains payment id and recovers through fulfilled status", async () => {
    const harness = await createMainnetBrowserFetchHarness();
    const storage = createMemorySessionStorage();
    const controller = new MainnetPayController({
      origin: harness.origin,
      policy: { sellerAddress: MAINNET_TEST_SELLER },
      fetchImpl: harness.fetchImpl,
      sessionStorage: storage,
      pollPolicy: { intervalMs: 0, maxPolls: 10 },
      scheduler: createFakeScheduler(),
    });
    await controller.loadTerms();
    await controller.submitPayment("response-loss");
    expect(["potentially-submitted", "polling-status", "success"]).toContain(
      controller.snapshot.uiState,
    );
    expect(controller.snapshot.paymentIdentifier).toMatch(/^pay_/);
    expect(storage.getItem(MAINNET_PENDING_PAYMENT_SESSION_KEY)).toContain(
      controller.snapshot.paymentIdentifier,
    );
    expect(storage.getItem(MAINNET_PENDING_PAYMENT_SESSION_KEY)).not.toContain(
      FAKE_MAINNET_SIGNATURE,
    );

    await vi.waitFor(
      () => {
        expect(controller.snapshot.uiState).toBe("success");
      },
      { timeout: 5000 },
    );
    expect(controller.snapshot.paymentBearingRequestCount).toBe(1);
    expect(controller.snapshot.signingCount).toBe(1);
    expect(storage.getItem(MAINNET_PENDING_PAYMENT_SESSION_KEY)).toBeNull();
    await harness.dispose();
  });

  it("22-24 status polling is read-only and never signs or resubmits", async () => {
    const harness = await createMainnetBrowserFetchHarness();
    const signer = createFakeMainnetSigner();
    const paidCalls: string[] = [];
    const fetchImpl: typeof fetch = async (input, init) => {
      const url = String(input);
      const headers = new Headers(init?.headers ?? {});
      if (
        url.includes("/v1/example") &&
        (headers.get("payment-signature") ?? headers.get("PAYMENT-SIGNATURE"))
      ) {
        paidCalls.push(url);
      }
      return harness.fetchImpl(input, init);
    };
    const controller = new MainnetPayController({
      origin: harness.origin,
      policy: { sellerAddress: MAINNET_TEST_SELLER },
      fetchImpl,
      signer,
      pollPolicy: { intervalMs: 0, maxPolls: 3 },
      scheduler: createFakeScheduler(),
    });
    await controller.loadTerms();
    await controller.submitPayment("response-loss");
    await vi.waitFor(() => expect(controller.snapshot.uiState).toBe("success"), {
      timeout: 5000,
    });
    expect(signer.recorder.invocationCount).toBe(1);
    expect(paidCalls.length).toBe(1);
    const statusLookup = await fetchPaymentStatus({
      fetchImpl: harness.fetchImpl,
      origin: harness.origin,
      paymentIdentifier: controller.snapshot.paymentIdentifier ?? "missing",
    });
    expect(statusLookup.ok).toBe(true);
    await harness.dispose();
  });

  it("29-35 status polling handles terminal and malformed states fail-closed", async () => {
    const scheduler = createFakeScheduler();
    const fetchImpl = vi.fn(async () =>
      Response.json({ state: "not_seen" }, { status: 404, headers: { "Cache-Control": "no-store" } }),
    );
    const notSeen = await pollPaymentStatus({
      fetchImpl,
      origin: "http://localhost",
      paymentIdentifier: "pay_notseen00000001",
      policy: { intervalMs: 0, maxPolls: 2 },
      scheduler,
    });
    expect(notSeen.kind).toBe("not_seen_limit");

    const malformed = await pollPaymentStatus({
      fetchImpl: vi.fn(async () => Response.json({ unexpected: true })),
      origin: "http://localhost",
      paymentIdentifier: "pay_malformed000001",
      policy: { intervalMs: 0, maxPolls: 1 },
      scheduler,
    });
    expect(malformed.kind).toBe("malformed");

    const uncertain = await pollPaymentStatus({
      fetchImpl: vi.fn(async () =>
        Response.json({ state: "uncertain", canRetry: false }, { headers: { "Cache-Control": "no-store" } }),
      ),
      origin: "http://localhost",
      paymentIdentifier: "pay_uncertain000001",
      policy: { intervalMs: 0, maxPolls: 1 },
      scheduler,
    });
    expect(uncertain.kind).toBe("uncertain");
  });

  it("36-38 sanitizes rendered output and shortens sensitive identifiers", () => {
    const htmlLike = "<script>alert(1)</script>";
    const rendered = formatPaidApiText({ output: { value: htmlLike } });
    expect(rendered).toContain("<script>");
    expect(containsPrivateData(rendered)).toBe(false);

    const fullHash = `0x${"ab".repeat(32)}`;
    expect(containsPrivateData(fullHash)).toBe(true);
    expect(containsPrivateData("pay_7d5d747be160e280504c099d984bcfe0")).toBe(false);
  });

  it("39-44 refresh recovery, malformed session cleanup, and reset behavior", async () => {
    const storage = createMemorySessionStorage();
    savePendingMainnetPaymentSession(storage, {
      version: 1,
      paymentIdentifier: "pay_refresh00000001",
      queryValue: MAINNET_TEST_QUERY_VALUE,
      routePath: "/v1/example",
      createdAt: new Date().toISOString(),
      state: "potentially-submitted",
    });

    const harness = await createMainnetBrowserFetchHarness();
    const controller = new MainnetPayController({
      origin: harness.origin,
      policy: { sellerAddress: MAINNET_TEST_SELLER },
      fetchImpl: harness.fetchImpl,
      sessionStorage: storage,
      pollPolicy: { intervalMs: 0, maxPolls: 1 },
      scheduler: createFakeScheduler(),
    });
    controller.recoverPendingSessionOnLoad();
    expect(["potentially-submitted", "polling-status"]).toContain(
      controller.snapshot.uiState,
    );

    storage.setItem(MAINNET_PENDING_PAYMENT_SESSION_KEY, "{not-json");
    expect(readPendingMainnetPaymentSession(storage)).toBeNull();

    savePendingMainnetPaymentSession(storage, {
      version: 1,
      paymentIdentifier: "pay_old00000000001",
      queryValue: MAINNET_TEST_QUERY_VALUE,
      routePath: "/v1/example",
      createdAt: new Date(Date.now() - MAINNET_SESSION_MAX_AGE_MS - 1000).toISOString(),
      state: "potentially-submitted",
    });
    expect(readPendingMainnetPaymentSession(storage)).toBeNull();

    controller.reset();
    expect(controller.snapshot.uiState).toBe("idle");
    await harness.dispose();
  });

  it("45-48 enforces one signature and one paid fetch under double submit and delays", async () => {
    const harness = await createMainnetBrowserFetchHarness({
      facilitator: { verifyMode: { delayMs: 50 }, settleMode: "success" },
    });
    const signer = createFakeMainnetSigner();
    const controller = new MainnetPayController({
      origin: harness.origin,
      policy: { sellerAddress: MAINNET_TEST_SELLER },
      fetchImpl: harness.fetchImpl,
      signer,
    });
    await controller.loadTerms();
    await Promise.all([
      controller.submitPayment("normal"),
      controller.submitPayment("normal"),
    ]);
    expect(signer.recorder.invocationCount).toBe(1);
    expect(controller.snapshot.paymentBearingRequestCount).toBe(1);
    expect(harness.facilitator.counts.verify).toBe(1);
    expect(harness.facilitator.counts.settle).toBe(1);

    const lossHarness = await createMainnetBrowserFetchHarness({
      facilitator: { verifyMode: { delayMs: 50 }, settleMode: { delayMs: 50 } },
    });
    const lossController = new MainnetPayController({
      origin: lossHarness.origin,
      policy: { sellerAddress: MAINNET_TEST_SELLER },
      fetchImpl: lossHarness.fetchImpl,
      pollPolicy: { intervalMs: 0, maxPolls: 10 },
      scheduler: createFakeScheduler(),
    });
    await lossController.loadTerms();
    await lossController.submitPayment("response-loss");
    await vi.waitFor(() => expect(lossController.snapshot.uiState).toBe("success"), {
      timeout: 5000,
    });
    expect(lossHarness.facilitator.counts.verify).toBe(1);
    expect(lossHarness.facilitator.counts.settle).toBe(1);
    await harness.dispose();
    await lossHarness.dispose();
  });

  it("49-51 production mainnet entry remains isolated from mock harness", async () => {
    const mf = await import("./helpers/mainnet-coordinator-harness.js").then((m) =>
      m.createMainnetCoordinatorMiniflare(),
    );
    const disabled = await mf.dispatchFetch("http://localhost/v1/example?value=hello");
    expect(disabled.status).toBe(503);
    const mockPage = await mf.dispatchFetch("http://localhost/mock-pay");
    expect(mockPage.status).toBe(404);
    await mf.dispose();

    const mainnetBundle = readFileSync(
      path.join(projectRoot, "dist-mainnet/index.mainnet.js"),
      "utf8",
    );
    expect(mainnetBundle).not.toContain("mock-pay");
    expect(mainnetBundle).not.toContain("index.mainnet-mock-harness");
  });

  it("25-27 fulfilled status route returns cached deterministic result from DO storage", async () => {
    const harness = await createMainnetBrowserFetchHarness();
    const controller = new MainnetPayController({
      origin: harness.origin,
      policy: { sellerAddress: MAINNET_TEST_SELLER },
      fetchImpl: harness.fetchImpl,
      pollPolicy: { intervalMs: 0, maxPolls: 10 },
      scheduler: createFakeScheduler(),
    });
    await controller.loadTerms();
    await controller.submitPayment("response-loss");
    await vi.waitFor(() => expect(controller.snapshot.uiState).toBe("success"), {
      timeout: 5000,
    });
    expect(controller.snapshot.paidBody).toEqual({
      success: true,
      service: "x402 Worker Template",
      input: { value: MAINNET_TEST_QUERY_VALUE },
      output: { value: MAINNET_TEST_QUERY_VALUE },
    });
    await harness.dispose();
  });

  it("52-54 keeps testnet bundle unchanged and exercises actual Durable Object SQLite", async () => {
    const testnetBundle = readFileSync(
      path.join(projectRoot, "src/generated/pay-assets.ts"),
      "utf8",
    );
    expect(testnetBundle).not.toContain("mainnet/browser/mock-pay-main");
    expect(testnetBundle).not.toContain("mock-pay");

    const { deps, dispose } = await createMainnetOrchestratorContext();
    const unpaid = await dispatchMainnetUnpaidRequest(deps);
    expect(unpaid.status).toBe(402);
    await dispose();
  });
});
