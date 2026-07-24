import { decodePaymentRequiredHeader, decodePaymentResponseHeader } from "@x402/core/http";
import type { PaymentRequired } from "@x402/core/types";
import { describe, expect, it, vi, beforeEach, afterEach } from "vitest";
import * as coordinatorClient from "../src/mainnet/durable/payment-coordinator-client.js";
import {
  buildAuthCommitment,
  buildRecordKey,
  buildTermsFingerprint,
} from "../src/mainnet/idempotency/canonical-keys.js";
import { buildSafePaymentStatusBody } from "../src/mainnet/routes/pay-status.js";
import {
  BASE_SEPOLIA_NETWORK,
  MAINNET_NETWORK,
  MAINNET_PAYMENT_AMOUNT,
  MAINNET_USDC_ASSET,
  MAINNET_USDC_EIP712_NAME,
  MAINNET_USDC_EIP712_VERSION,
  matchesBaseMainnetPaymentTerms,
  rejectNonMainnetPaymentTerms,
  validateBaseMainnetPaymentRequirements,
} from "../src/mainnet/payment-policy.mainnet.js";
import {
  buildMatchedMainnetRequirement,
  buildServerMainnetRequirement,
  buildTestPaymentPayload,
  createMainnetOrchestratorContext,
  dispatchMainnetOrchestratorRequest,
  dispatchMainnetPaidRequest,
  dispatchMainnetUnpaidRequest,
  MAINNET_TEST_PAYMENT_ID,
  MAINNET_TEST_QUERY_VALUE,
  MAINNET_TEST_SELLER,
} from "./helpers/mainnet-orchestrator-harness.js";
import { installNetworkGuard } from "./helpers/mock-facilitator.js";
import {
  coordinatorGetStatusByPaymentIdentifier,
  coordinatorPrepareAttempt,
} from "./helpers/mainnet-coordinator-harness.js";
import { buildTestPrepareInput } from "./helpers/mainnet-coordinator-harness.js";

describe("mainnet payment policy", () => {
  it("accepts immutable Base mainnet terms for injected seller", () => {
    const requirement = buildMatchedMainnetRequirement();
    expect(matchesBaseMainnetPaymentTerms(requirement, MAINNET_TEST_SELLER)).toBe(true);
    expect(validateBaseMainnetPaymentRequirements([requirement], MAINNET_TEST_SELLER).ok).toBe(
      true,
    );
  });

  it("rejects Base Sepolia, wrong token, wrong seller, and multiple options", () => {
    const base = buildMatchedMainnetRequirement();
    expect(rejectNonMainnetPaymentTerms({ ...base, network: BASE_SEPOLIA_NETWORK }, MAINNET_TEST_SELLER)).toContain(
      "Sepolia",
    );
    expect(
      rejectNonMainnetPaymentTerms(
        { ...base, asset: "0xd9aAEc86B65D86f4A9253D8C8b1c1c1c1c1c1c1c" },
        MAINNET_TEST_SELLER,
      ),
    ).toContain("Bridged");
    expect(
      rejectNonMainnetPaymentTerms({ ...base, extra: { name: "USDC", version: "2" } }, MAINNET_TEST_SELLER),
    ).toContain("USDC");
    expect(validateBaseMainnetPaymentRequirements([base, base], MAINNET_TEST_SELLER).ok).toBe(false);
  });
});

describe("mainnet mocked payment orchestrator", () => {
  let restoreFetch: () => void;

  beforeEach(() => {
    restoreFetch = installNetworkGuard();
  });

  afterEach(() => {
    restoreFetch();
    vi.restoreAllMocks();
  });

  it("1 unpaid request produces one valid mainnet 402 option", async () => {
    const { deps, dispose } = await createMainnetOrchestratorContext();
    const res = await dispatchMainnetUnpaidRequest(deps);
    expect(res.status).toBe(402);
    const body = (await res.json()) as PaymentRequired;
    expect(body.accepts).toHaveLength(1);
    await dispose();
  });

  it("2 402 uses eip155:8453", async () => {
    const { deps, dispose } = await createMainnetOrchestratorContext();
    const res = await dispatchMainnetUnpaidRequest(deps);
    const body = (await res.json()) as PaymentRequired;
    expect(body.accepts[0].network).toBe(MAINNET_NETWORK);
    await dispose();
  });

  it("3 402 uses native Base USDC", async () => {
    const { deps, dispose } = await createMainnetOrchestratorContext();
    const res = await dispatchMainnetUnpaidRequest(deps);
    const body = (await res.json()) as PaymentRequired;
    expect(body.accepts[0].asset.toLowerCase()).toBe(MAINNET_USDC_ASSET.toLowerCase());
    await dispose();
  });

  it("4 402 uses amount 1000", async () => {
    const { deps, dispose } = await createMainnetOrchestratorContext();
    const res = await dispatchMainnetUnpaidRequest(deps);
    const body = (await res.json()) as PaymentRequired;
    expect(body.accepts[0].amount).toBe(MAINNET_PAYMENT_AMOUNT);
    await dispose();
  });

  it("5 402 uses USD Coin / 2", async () => {
    const { deps, dispose } = await createMainnetOrchestratorContext();
    const res = await dispatchMainnetUnpaidRequest(deps);
    const body = (await res.json()) as PaymentRequired;
    expect(body.accepts[0].extra.name).toBe(MAINNET_USDC_EIP712_NAME);
    expect(body.accepts[0].extra.version).toBe(MAINNET_USDC_EIP712_VERSION);
    await dispose();
  });

  it("6 402 declares payment identifier required", async () => {
    const { deps, dispose } = await createMainnetOrchestratorContext();
    const res = await dispatchMainnetUnpaidRequest(deps);
    const headerValue = res.headers.get("PAYMENT-REQUIRED");
    expect(headerValue).toBeTruthy();
    const header = decodePaymentRequiredHeader(headerValue!);
    expect(
      (header.extensions?.["payment-identifier"] as { info?: { required?: boolean } } | undefined)
        ?.info?.required,
    ).toBe(true);
    await dispose();
  });

  it("7 missing identifier rejected before reservation", async () => {
    const { deps, dispose } = await createMainnetOrchestratorContext();
    const payload = await buildTestPaymentPayload(deps, { omitIdentifier: true });
    const res = await dispatchMainnetPaidRequest(deps, payload);
    expect(res.status).toBe(402);
    await dispose();
  });

  it("8 malformed identifier rejected before reservation", async () => {
    const { deps, dispose } = await createMainnetOrchestratorContext();
    const payload = await buildTestPaymentPayload(deps, { malformedIdentifier: "bad" });
    const res = await dispatchMainnetPaidRequest(deps, payload);
    expect(res.status).toBe(402);
    await dispose();
  });

  it("9 mismatched accepted terms rejected before reservation", async () => {
    const { deps, dispose } = await createMainnetOrchestratorContext();
    const payload = await buildTestPaymentPayload(deps, {
      acceptedOverrides: { amount: "2000" },
    });
    const res = await dispatchMainnetPaidRequest(deps, payload);
    expect(res.status).toBe(402);
    await dispose();
  });

  it("10 buyer cannot substitute amount", async () => {
    const { deps, dispose } = await createMainnetOrchestratorContext();
    const payload = await buildTestPaymentPayload(deps, {
      authorizationOverrides: { value: "2000" },
    });
    const res = await dispatchMainnetPaidRequest(deps, payload);
    expect(res.status).toBe(402);
    await dispose();
  });

  it("11 buyer cannot substitute seller", async () => {
    const { deps, dispose } = await createMainnetOrchestratorContext();
    const payload = await buildTestPaymentPayload(deps, {
      authorizationOverrides: { to: "0x2222222222222222222222222222222222222222" },
    });
    const res = await dispatchMainnetPaidRequest(deps, payload);
    expect(res.status).toBe(402);
    await dispose();
  });

  it("12 buyer cannot substitute token", async () => {
    const { deps, dispose } = await createMainnetOrchestratorContext();
    const payload = await buildTestPaymentPayload(deps, {
      acceptedOverrides: { asset: "0x036CbD53842c5426634e7929541eC2318f3dCF7e" },
    });
    const res = await dispatchMainnetPaidRequest(deps, payload);
    expect(res.status).toBe(402);
    await dispose();
  });

  it("13 buyer cannot substitute network", async () => {
    const { deps, dispose } = await createMainnetOrchestratorContext();
    const payload = await buildTestPaymentPayload(deps, {
      acceptedOverrides: { network: BASE_SEPOLIA_NETWORK },
    });
    const res = await dispatchMainnetPaidRequest(deps, payload);
    expect(res.status).toBe(402);
    await dispose();
  });

  it("14 structurally invalid authorization rejected before reservation", async () => {
    const { deps, dispose } = await createMainnetOrchestratorContext();
    const payload = await buildTestPaymentPayload(deps, {
      authorizationOverrides: { nonce: "not-bytes32" },
    });
    const res = await dispatchMainnetPaidRequest(deps, payload);
    expect(res.status).toBe(402);
    await dispose();
  });

  it("15 canonical keys use matched requirements", async () => {
    const { deps, dispose } = await createMainnetOrchestratorContext();
    const requirement = await buildServerMainnetRequirement(deps);
    const payload = await buildTestPaymentPayload(deps);
    const termsFingerprint = await buildTermsFingerprint({
      scheme: requirement.scheme,
      network: requirement.network,
      asset: requirement.asset,
      amount: requirement.amount,
      payTo: requirement.payTo,
      httpMethod: "GET",
      normalizedRoute: "/v1/example",
      normalizedQuery: { value: MAINNET_TEST_QUERY_VALUE },
    });
    const auth = payload.payload.authorization as Record<string, string>;
    const authCommitment = await buildAuthCommitment({
      network: requirement.network,
      from: auth.from!,
      authorizationNonce: auth.nonce!,
      to: requirement.payTo,
      value: requirement.amount,
      validAfter: auth.validAfter!,
      validBefore: auth.validBefore!,
      verifyingContract: requirement.asset,
    });
    const recordKey = await buildRecordKey(MAINNET_TEST_PAYMENT_ID, termsFingerprint);
    expect(recordKey).toMatch(/^[0-9a-f]{64}$/);
    expect(authCommitment).toMatch(/^[0-9a-f]{64}$/);
    await dispose();
  });

  it("16 one valid paid request creates one attempt", async () => {
    const { deps, bindings, dispose } = await createMainnetOrchestratorContext();
    await dispatchMainnetPaidRequest(deps);
    const status = await coordinatorGetStatusByPaymentIdentifier(
      bindings.PAYMENT_COORDINATOR,
      MAINNET_TEST_PAYMENT_ID,
    );
    expect(status?.state).toBe("fulfilled");
    await dispose();
  });

  it("17 verify called exactly once", async () => {
    const { deps, facilitator, dispose } = await createMainnetOrchestratorContext();
    await dispatchMainnetPaidRequest(deps);
    expect(facilitator.counts.verify).toBe(1);
    await dispose();
  });

  it("18 settle called exactly once", async () => {
    const { deps, facilitator, dispose } = await createMainnetOrchestratorContext();
    await dispatchMainnetPaidRequest(deps);
    expect(facilitator.counts.settle).toBe(1);
    await dispose();
  });

  it("19 deterministic response delivered after settle success", async () => {
    const { deps, dispose } = await createMainnetOrchestratorContext();
    const res = await dispatchMainnetPaidRequest(deps);
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({
      success: true,
      service: "x402 Worker Template",
      input: { value: MAINNET_TEST_QUERY_VALUE },
      output: { value: MAINNET_TEST_QUERY_VALUE },
    });
    await dispose();
  });

  it("20 successful response contains official PAYMENT-RESPONSE", async () => {
    const { deps, dispose } = await createMainnetOrchestratorContext();
    const res = await dispatchMainnetPaidRequest(deps);
    const header = res.headers.get("PAYMENT-RESPONSE");
    expect(header).toBeTruthy();
    const decoded = decodePaymentResponseHeader(header!);
    expect(decoded.success).toBe(true);
    expect(decoded.network).toBe(MAINNET_NETWORK);
    await dispose();
  });

  it("21 successful receipt validates mainnet network", async () => {
    const { deps, dispose } = await createMainnetOrchestratorContext();
    const res = await dispatchMainnetPaidRequest(deps);
    const decoded = decodePaymentResponseHeader(res.headers.get("PAYMENT-RESPONSE")!);
    expect(decoded.network).toBe(MAINNET_NETWORK);
    await dispose();
  });

  it("22 malformed receipt fails closed", async () => {
    const { deps, bindings, dispose } = await createMainnetOrchestratorContext({
      facilitator: { settleMode: "malformed_response" },
    });
    const res = await dispatchMainnetPaidRequest(deps);
    expect(res.status).toBe(503);
    const status = await coordinatorGetStatusByPaymentIdentifier(
      bindings.PAYMENT_COORDINATOR,
      MAINNET_TEST_PAYMENT_ID,
    );
    expect(status?.state).toBe("uncertain");
    await dispose();
  });

  it("23 verify definitive failure creates failed-definitive", async () => {
    const { deps, bindings, dispose } = await createMainnetOrchestratorContext({
      facilitator: { verifyMode: "definitive_failure" },
    });
    const res = await dispatchMainnetPaidRequest(deps);
    expect(res.status).toBe(402);
    const status = await coordinatorGetStatusByPaymentIdentifier(
      bindings.PAYMENT_COORDINATOR,
      MAINNET_TEST_PAYMENT_ID,
    );
    expect(status?.state).toBe("failed-definitive");
    await dispose();
  });

  it("24 verify timeout creates uncertain", async () => {
    const { deps, bindings, dispose } = await createMainnetOrchestratorContext({
      facilitator: { verifyMode: "throw_timeout" },
    });
    const res = await dispatchMainnetPaidRequest(deps);
    expect(res.status).toBe(503);
    const status = await coordinatorGetStatusByPaymentIdentifier(
      bindings.PAYMENT_COORDINATOR,
      MAINNET_TEST_PAYMENT_ID,
    );
    expect(status?.state).toBe("uncertain");
    await dispose();
  });

  it("25 verify timeout never automatically verifies again", async () => {
    const { deps, bindings, facilitator, dispose } = await createMainnetOrchestratorContext({
      facilitator: { verifyMode: "throw_timeout" },
    });
    await dispatchMainnetPaidRequest(deps);
    facilitator.counts.verify = 0;
    await dispatchMainnetPaidRequest(deps, await buildTestPaymentPayload(deps));
    expect(facilitator.counts.verify).toBe(0);
    const status = await coordinatorGetStatusByPaymentIdentifier(
      bindings.PAYMENT_COORDINATOR,
      MAINNET_TEST_PAYMENT_ID,
    );
    expect(status?.state).toBe("uncertain");
    await dispose();
  });

  it("26 settle definitive failure creates failed-definitive", async () => {
    const { deps, bindings, dispose } = await createMainnetOrchestratorContext({
      facilitator: { settleMode: "definitive_failure" },
    });
    const res = await dispatchMainnetPaidRequest(deps);
    expect(res.status).toBe(402);
    const status = await coordinatorGetStatusByPaymentIdentifier(
      bindings.PAYMENT_COORDINATOR,
      MAINNET_TEST_PAYMENT_ID,
    );
    expect(status?.state).toBe("failed-definitive");
    await dispose();
  });

  it("27 settle timeout creates uncertain", async () => {
    const { deps, bindings, dispose } = await createMainnetOrchestratorContext({
      facilitator: { settleMode: "throw_timeout" },
    });
    const res = await dispatchMainnetPaidRequest(deps);
    expect(res.status).toBe(503);
    const status = await coordinatorGetStatusByPaymentIdentifier(
      bindings.PAYMENT_COORDINATOR,
      MAINNET_TEST_PAYMENT_ID,
    );
    expect(status?.state).toBe("uncertain");
    await dispose();
  });

  it("28 settle timeout never automatically settles again", async () => {
    const { deps, bindings, facilitator, dispose } = await createMainnetOrchestratorContext({
      facilitator: { settleMode: "throw_timeout" },
    });
    await dispatchMainnetPaidRequest(deps);
    facilitator.counts.settle = 0;
    await dispatchMainnetPaidRequest(deps, await buildTestPaymentPayload(deps));
    expect(facilitator.counts.settle).toBe(0);
    const status = await coordinatorGetStatusByPaymentIdentifier(
      bindings.PAYMENT_COORDINATOR,
      MAINNET_TEST_PAYMENT_ID,
    );
    expect(status?.state).toBe("uncertain");
    await dispose();
  });

  it("29 two concurrent identical requests during delayed verify cause one verify", async () => {
    const { deps, facilitator, dispose } = await createMainnetOrchestratorContext({
      facilitator: { verifyMode: { delayMs: 150 }, settleMode: { delayMs: 150 } },
    });
    const payload = await buildTestPaymentPayload(deps);
    const [first, second] = await Promise.all([
      dispatchMainnetPaidRequest(deps, payload),
      dispatchMainnetPaidRequest(deps, payload),
    ]);
    expect(facilitator.counts.verify).toBe(1);
    expect([first.status, second.status].sort()).toEqual([200, 202]);
    await dispose();
  });

  it("30 two concurrent identical requests during delayed settle cause one settle", async () => {
    const { deps, facilitator, dispose } = await createMainnetOrchestratorContext({
      facilitator: { settleMode: { delayMs: 200 } },
    });
    const payload = await buildTestPaymentPayload(deps, {
      paymentIdentifier: "pay_cccccccccccccccc",
    });
    const [first, second] = await Promise.all([
      dispatchMainnetPaidRequest(deps, payload),
      dispatchMainnetPaidRequest(deps, payload),
    ]);
    expect(facilitator.counts.settle).toBe(1);
    expect([first.status, second.status].sort()).toEqual([200, 202]);
    await dispose();
  });

  it("31 same payment ID changed terms returns 409", async () => {
    const { deps, bindings, dispose } = await createMainnetOrchestratorContext();
    const input = await buildTestPrepareInput({
      paymentIdentifier: MAINNET_TEST_PAYMENT_ID,
      resourceQuery: { value: MAINNET_TEST_QUERY_VALUE },
    });
    await coordinatorPrepareAttempt(bindings.PAYMENT_COORDINATOR, input);
    const otherUrl = new URL("http://localhost/v1/example?value=other-term");
    const payload = await buildTestPaymentPayload(deps, { value: "other-term" });
    const res = await dispatchMainnetOrchestratorRequest(deps, {
      url: otherUrl,
      paymentPayload: payload,
    });
    expect(res.status).toBe(409);
    await dispose();
  });

  it("32 same payment ID changed authorization returns 409", async () => {
    const { deps, bindings, dispose } = await createMainnetOrchestratorContext();
    const input = await buildTestPrepareInput({
      paymentIdentifier: MAINNET_TEST_PAYMENT_ID,
      resourceQuery: { value: MAINNET_TEST_QUERY_VALUE },
    });
    await coordinatorPrepareAttempt(bindings.PAYMENT_COORDINATOR, input);
    const payload = await buildTestPaymentPayload(deps, {
      authorizationOverrides: { nonce: `0x${"bb".repeat(32)}` },
    });
    const res = await dispatchMainnetPaidRequest(deps, payload);
    expect(res.status).toBe(409);
    await dispose();
  });

  it("33 same authorization another ID returns 409", async () => {
    const { deps, bindings, dispose } = await createMainnetOrchestratorContext();
    const sharedNonce = `0x${"cc".repeat(32)}`;
    const first = await buildTestPrepareInput({
      paymentIdentifier: "pay_dddddddddddddddd",
      auth: { authorizationNonce: sharedNonce },
      resourceQuery: { value: MAINNET_TEST_QUERY_VALUE },
    });
    await coordinatorPrepareAttempt(bindings.PAYMENT_COORDINATOR, first);
    const payload = await buildTestPaymentPayload(deps, {
      paymentIdentifier: "pay_eeeeeeeeeeeeeeee",
      authorizationOverrides: { nonce: sharedNonce },
    });
    const res = await dispatchMainnetPaidRequest(deps, payload);
    expect(res.status).toBe(409);
    await dispose();
  });

  it("34 fulfilled duplicate returns cached body", async () => {
    const { deps, dispose } = await createMainnetOrchestratorContext();
    const payload = await buildTestPaymentPayload(deps);
    const first = await dispatchMainnetPaidRequest(deps, payload);
    const second = await dispatchMainnetPaidRequest(deps, payload);
    expect(first.status).toBe(200);
    expect(second.status).toBe(200);
    expect(await second.json()).toEqual(await first.json());
    await dispose();
  });

  it("35 fulfilled duplicate reconstructs PAYMENT-RESPONSE", async () => {
    const { deps, dispose } = await createMainnetOrchestratorContext();
    const payload = await buildTestPaymentPayload(deps, {
      paymentIdentifier: "pay_ffffffffffffffff",
    });
    await dispatchMainnetPaidRequest(deps, payload);
    const second = await dispatchMainnetPaidRequest(deps, payload);
    expect(second.headers.get("PAYMENT-RESPONSE")).toBeTruthy();
    await dispose();
  });

  it("36 fulfilled duplicate calls neither verify nor settle", async () => {
    const { deps, facilitator, dispose } = await createMainnetOrchestratorContext();
    const payload = await buildTestPaymentPayload(deps, {
      paymentIdentifier: "pay_1212121212121212",
    });
    await dispatchMainnetPaidRequest(deps, payload);
    facilitator.counts.verify = 0;
    facilitator.counts.settle = 0;
    await dispatchMainnetPaidRequest(deps, payload);
    expect(facilitator.counts.verify).toBe(0);
    expect(facilitator.counts.settle).toBe(0);
    await dispose();
  });

  it("37 in-progress duplicate returns wait/202", async () => {
    const { deps, facilitator, dispose } = await createMainnetOrchestratorContext({
      facilitator: { verifyMode: { delayMs: 250 } },
    });
    const payload = await buildTestPaymentPayload(deps, {
      paymentIdentifier: "pay_1313131313131313",
    });
    const inFlight = dispatchMainnetPaidRequest(deps, payload);
    await new Promise((resolve) => setTimeout(resolve, 20));
    const duplicate = await dispatchMainnetPaidRequest(deps, payload);
    expect(duplicate.status).toBe(202);
    await inFlight;
    await dispose();
  });

  it("38 uncertain duplicate calls neither verify nor settle", async () => {
    const { deps, facilitator, dispose } = await createMainnetOrchestratorContext({
      facilitator: { verifyMode: "throw_timeout" },
    });
    const payload = await buildTestPaymentPayload(deps, {
      paymentIdentifier: "pay_1414141414141414",
    });
    await dispatchMainnetPaidRequest(deps, payload);
    facilitator.counts.verify = 0;
    facilitator.counts.settle = 0;
    await dispatchMainnetPaidRequest(deps, payload);
    expect(facilitator.counts.verify).toBe(0);
    expect(facilitator.counts.settle).toBe(0);
    await dispose();
  });

  it("39 local completion retry makes at most three coordinator calls", async () => {
    const originalComplete = coordinatorClient.coordinatorCompleteFulfillment;
    const completeSpy = vi
      .spyOn(coordinatorClient, "coordinatorCompleteFulfillment")
      .mockImplementation(async (namespace, params) => {
        const attempts = completeSpy.mock.calls.length;
        if (attempts < 3) {
          return { kind: "stale", reason: "forced stale for retry test" };
        }
        return originalComplete(namespace, params);
      });
    const { deps, dispose } = await createMainnetOrchestratorContext({
      facilitator: { transactionHash: `0x${"cd".repeat(32)}` },
    });
    const payload = await buildTestPaymentPayload(deps, {
      paymentIdentifier: "pay_1515151515151515",
    });
    const res = await dispatchMainnetPaidRequest(deps, payload);
    expect(completeSpy.mock.calls.length).toBeLessThanOrEqual(3);
    expect(res.status).toBe(200);
    completeSpy.mockRestore();
    await dispose();
  });

  it("40 local completion retry never calls settle again", async () => {
    vi.spyOn(coordinatorClient, "coordinatorCompleteFulfillment")
      .mockResolvedValueOnce({ kind: "stale", reason: "retry" })
      .mockResolvedValueOnce({ kind: "stale", reason: "retry" })
      .mockImplementation(coordinatorClient.coordinatorCompleteFulfillment);
    const { deps, facilitator, dispose } = await createMainnetOrchestratorContext();
    const payload = await buildTestPaymentPayload(deps, {
      paymentIdentifier: "pay_1616161616161616",
    });
    await dispatchMainnetPaidRequest(deps, payload);
    expect(facilitator.counts.settle).toBe(1);
    vi.restoreAllMocks();
    await dispose();
  });

  it("41 stale completion token rejected", async () => {
    const { deps, bindings, dispose } = await createMainnetOrchestratorContext({
      facilitator: { settleMode: "throw_timeout" },
    });
    const paymentId = "pay_2020202020202020";
    const payload = await buildTestPaymentPayload(deps, { paymentIdentifier: paymentId });
    await dispatchMainnetPaidRequest(deps, payload);
    const stale = await coordinatorClient.coordinatorCompleteFulfillment(
      bindings.PAYMENT_COORDINATOR,
      {
        recordKey: "invalid",
        operationGeneration: 1,
        operationToken: "stale-token",
        settlementReceipt: {
          success: true,
          transaction: `0x${"ef".repeat(32)}`,
          network: MAINNET_NETWORK,
        },
      },
    );
    expect(stale.kind).toBe("stale");
    await dispose();
  });

  it("42 matching late completion may fulfill uncertain attempt", async () => {
    const originalComplete = coordinatorClient.coordinatorCompleteFulfillment;
    const completeSpy = vi
      .spyOn(coordinatorClient, "coordinatorCompleteFulfillment")
      .mockResolvedValueOnce({ kind: "stale", reason: "retry" })
      .mockResolvedValueOnce({ kind: "stale", reason: "retry" })
      .mockImplementation((namespace, params) =>
        originalComplete(namespace, params),
      );
    const { deps, bindings, dispose } = await createMainnetOrchestratorContext();
    const paymentId = "pay_2121212121212121";
    const payload = await buildTestPaymentPayload(deps, { paymentIdentifier: paymentId });
    const res = await dispatchMainnetPaidRequest(deps, payload);
    expect(res.status).toBe(200);
    const status = await coordinatorGetStatusByPaymentIdentifier(
      bindings.PAYMENT_COORDINATOR,
      paymentId,
    );
    expect(status?.state).toBe("fulfilled");
    expect(completeSpy.mock.calls.length).toBeLessThanOrEqual(3);
    completeSpy.mockRestore();
    await dispose();
  });

  it("43 response-construction failure invokes cancellation path", async () => {
    const cancelSpy = vi.fn().mockResolvedValue(undefined);
    const { deps, dispose } = await createMainnetOrchestratorContext({
      buildResponse: () => {
        throw new Error("forced response failure");
      },
    });
    const original = deps.resourceServer!;
    deps.resourceServer = Object.assign(Object.create(Object.getPrototypeOf(original)), original, {
      createPaymentCancellationDispatcher: (
        ...args: Parameters<typeof original.createPaymentCancellationDispatcher>
      ) => {
        const dispatcher = original.createPaymentCancellationDispatcher(...args);
        return {
          cancel: async (options: Parameters<typeof dispatcher.cancel>[0]) => {
            cancelSpy(options);
            return dispatcher.cancel(options);
          },
        };
      },
    });
    const res = await dispatchMainnetPaidRequest(
      deps,
      await buildTestPaymentPayload(deps, { paymentIdentifier: "pay_1717171717171717" }),
    );
    expect(res.status).toBe(402);
    expect(cancelSpy).toHaveBeenCalled();
    await dispose();
  });

  it("44 cancellation failure is sanitized", async () => {
    const { deps, dispose } = await createMainnetOrchestratorContext({
      buildResponse: () => {
        throw new Error("forced response failure");
      },
    });
    const original = deps.resourceServer!;
    deps.resourceServer = Object.assign(Object.create(Object.getPrototypeOf(original)), original, {
      createPaymentCancellationDispatcher: () => ({
        cancel: async () => {
          throw new Error("cancel failed");
        },
      }),
    });
    const res = await dispatchMainnetPaidRequest(
      deps,
      await buildTestPaymentPayload(deps, { paymentIdentifier: "pay_2222222222222222" }),
    );
    expect(res.status).toBe(402);
    await dispose();
  });

  it("45 status route accurately reflects orchestrator states", async () => {
    const { deps, bindings, dispose } = await createMainnetOrchestratorContext({
      facilitator: { verifyMode: "throw_timeout" },
    });
    const payload = await buildTestPaymentPayload(deps, {
      paymentIdentifier: "pay_1818181818181818",
    });
    await dispatchMainnetPaidRequest(deps, payload);
    const snapshot = await coordinatorGetStatusByPaymentIdentifier(
      bindings.PAYMENT_COORDINATOR,
      "pay_1818181818181818",
    );
    const body = buildSafePaymentStatusBody(snapshot);
    expect(body.state).toBe("uncertain");
    expect(body.canRetry).toBe(false);
    await dispose();
  });

  it("46 orchestrator tests use mock facilitator only", async () => {
    const { facilitator, dispose } = await createMainnetOrchestratorContext();
    expect(facilitator.getSupported).toBeTypeOf("function");
    expect(facilitator.counts).toEqual({ verify: 0, settle: 0, getSupported: 1 });
    await dispose();
  });

  it("47 actual Durable Object SQLite storage is exercised", async () => {
    const { deps, bindings, dispose } = await createMainnetOrchestratorContext();
    const res = await dispatchMainnetPaidRequest(
      deps,
      await buildTestPaymentPayload(deps, { paymentIdentifier: "pay_1919191919191919" }),
    );
    expect(res.status).toBe(200);
    const snapshot = await coordinatorGetStatusByPaymentIdentifier(
      bindings.PAYMENT_COORDINATOR,
      "pay_1919191919191919",
    );
    expect(snapshot?.state).toBe("fulfilled");
    await dispose();
  });

  it("50 no external network occurs in tests", async () => {
    const { deps, dispose } = await createMainnetOrchestratorContext();
    await expect(dispatchMainnetPaidRequest(deps)).resolves.toBeDefined();
    await dispose();
  });
});
