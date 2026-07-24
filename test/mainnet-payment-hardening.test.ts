import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it, vi, beforeEach, afterEach } from "vitest";
import {
  coordinatorFailPostVerifyDefinitive,
  coordinatorFailSettleDefinitive,
  coordinatorFailVerifyDefinitive,
  setCoordinatorFailureInjectionForTests,
} from "../src/mainnet/durable/payment-coordinator-client.js";
import { formatSafeCliErrorJson } from "../src/cli/safe-cli-error.js";
import { getAllowedLogFieldKeys, logStructured } from "../src/logging.js";
import {
  BASE_USDBC_ASSET,
  LEGACY_INCORRECT_USDBC_PLACEHOLDER,
  MAINNET_USDC_ASSET,
  matchesBaseMainnetPaymentTerms,
  rejectNonMainnetPaymentTerms,
} from "../src/mainnet/payment-policy.mainnet.js";
import {
  advanceToSettling,
  advanceToVerified,
  coordinatorGetStatusByPaymentIdentifier,
  createMainnetTestContext,
  fulfillAttempt,
  prepareCreatedAttempt,
} from "./helpers/mainnet-coordinator-harness.js";
import {
  buildMatchedMainnetRequirement,
  buildTestPaymentPayload,
  createMainnetOrchestratorContext,
  dispatchMainnetPaidRequest,
  MAINNET_TEST_PAYMENT_ID,
  MAINNET_TEST_SELLER,
} from "./helpers/mainnet-orchestrator-harness.js";
import { installNetworkGuard } from "./helpers/mock-facilitator.js";

const projectRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

describe("mainnet payment hardening", () => {
  describe("Base token constants", () => {
    it("rejects official Base USDbC address", () => {
      const base = buildMatchedMainnetRequirement();
      expect(
        rejectNonMainnetPaymentTerms({ ...base, asset: BASE_USDBC_ASSET }, MAINNET_TEST_SELLER),
      ).toContain("USDbC");
    });

    it("accepts native Base USDC", () => {
      const base = buildMatchedMainnetRequirement();
      expect(matchesBaseMainnetPaymentTerms(base, MAINNET_TEST_SELLER)).toBe(true);
      expect(base.asset.toLowerCase()).toBe(MAINNET_USDC_ASSET.toLowerCase());
    });

    it("does not treat legacy incorrect bridge placeholder as authoritative", () => {
      const base = buildMatchedMainnetRequirement();
      expect(
        rejectNonMainnetPaymentTerms(
          { ...base, asset: LEGACY_INCORRECT_USDBC_PLACEHOLDER },
          MAINNET_TEST_SELLER,
        ),
      ).toContain("Unsupported asset");
      expect(
        rejectNonMainnetPaymentTerms(
          { ...base, asset: LEGACY_INCORRECT_USDBC_PLACEHOLDER },
          MAINNET_TEST_SELLER,
        ),
      ).not.toContain("USDbC");
    });
  });

  describe("authenticated coordinator failures", () => {
    it("does not expose unguarded failDefinitive RPC", async () => {
      const source = readFileSync(
        path.join(projectRoot, "src/mainnet/durable/payment-attempt-types.ts"),
        "utf8",
      );
      expect(source).not.toContain('"failDefinitive"');
      expect(source).toContain("failVerifyDefinitive");
      expect(source).toContain("failPostVerifyDefinitive");
      expect(source).toContain("failSettleDefinitive");
    });

    it("requires verify token and generation for verify definitive failure", async () => {
      const { bindings } = await createMainnetTestContext();
      const { recordKey } = await prepareCreatedAttempt(bindings);
      const lease = await advanceToVerified(bindings, recordKey);
      const stale = await coordinatorFailVerifyDefinitive(bindings.PAYMENT_COORDINATOR, {
        recordKey,
        operationGeneration: lease.operationGeneration,
        operationToken: "deadbeef".repeat(8),
        failureCategory: "verify_invalid",
      });
      expect(stale.kind).toBe("stale");
      await bindings.PAYMENT_COORDINATOR.idFromName("x402-mainnet-payment-coordinator");
    });

    it("requires verify token and generation for post-verify definitive failure", async () => {
      const { bindings } = await createMainnetTestContext();
      const { recordKey, input } = await prepareCreatedAttempt(bindings);
      const lease = await advanceToVerified(bindings, recordKey);
      const failed = await coordinatorFailPostVerifyDefinitive(bindings.PAYMENT_COORDINATOR, {
        recordKey,
        operationGeneration: lease.operationGeneration,
        operationToken: lease.operationToken,
        failureCategory: "response_construction_failed",
      });
      expect(failed.kind).toBe("failed");
      const status = await coordinatorGetStatusByPaymentIdentifier(
        bindings.PAYMENT_COORDINATOR,
        input.paymentIdentifier,
      );
      expect(status?.state).toBe("failed-definitive");
    });

    it("requires settle token and generation for settle definitive failure", async () => {
      const { bindings } = await createMainnetTestContext();
      const { recordKey } = await prepareCreatedAttempt(bindings);
      const lease = await advanceToSettling(bindings, recordKey);
      if (lease.kind !== "acquired") {
        throw new Error("Expected settle lease");
      }
      const stale = await coordinatorFailSettleDefinitive(bindings.PAYMENT_COORDINATOR, {
        recordKey,
        operationGeneration: lease.operationGeneration,
        operationToken: "deadbeef".repeat(8),
        failureCategory: "settle_failed",
      });
      expect(stale.kind).toBe("stale");
    });

    it("cannot downgrade fulfilled records", async () => {
      const { bindings } = await createMainnetTestContext();
      const { recordKey, input } = await prepareCreatedAttempt(bindings);
      const lease = await advanceToSettling(bindings, recordKey);
      if (lease.kind !== "acquired") {
        throw new Error("Expected settle lease");
      }
      await fulfillAttempt(bindings, recordKey, lease);
      const stale = await coordinatorFailSettleDefinitive(bindings.PAYMENT_COORDINATOR, {
        recordKey,
        operationGeneration: lease.operationGeneration,
        operationToken: lease.operationToken,
        failureCategory: "settle_failed",
      });
      expect(stale.kind).toBe("stale");
      const status = await coordinatorGetStatusByPaymentIdentifier(
        bindings.PAYMENT_COORDINATOR,
        input.paymentIdentifier,
      );
      expect(status?.state).toBe("fulfilled");
    });

    it("cannot fail uncertain attempt with stale token", async () => {
      const { bindings } = await createMainnetTestContext();
      const { recordKey } = await prepareCreatedAttempt(bindings);
      const lease = await advanceToSettling(bindings, recordKey);
      if (lease.kind !== "acquired") {
        throw new Error("Expected settle lease");
      }
      const { coordinatorMarkSettleUncertain } = await import(
        "./helpers/mainnet-coordinator-harness.js"
      );
      await coordinatorMarkSettleUncertain(bindings.PAYMENT_COORDINATOR, {
        recordKey,
        operationGeneration: lease.operationGeneration,
        operationToken: lease.operationToken,
      });
      const stale = await coordinatorFailSettleDefinitive(bindings.PAYMENT_COORDINATOR, {
        recordKey,
        operationGeneration: lease.operationGeneration,
        operationToken: lease.operationToken,
        failureCategory: "settle_failed",
      });
      expect(stale.kind).toBe("stale");
    });

    it("preserves matching late fulfillment after uncertain", async () => {
      const { bindings } = await createMainnetTestContext();
      const { recordKey, input } = await prepareCreatedAttempt(bindings);
      const lease = await advanceToSettling(bindings, recordKey);
      if (lease.kind !== "acquired") {
        throw new Error("Expected settle lease");
      }
      const { coordinatorMarkSettleUncertain } = await import(
        "./helpers/mainnet-coordinator-harness.js"
      );
      await coordinatorMarkSettleUncertain(bindings.PAYMENT_COORDINATOR, {
        recordKey,
        operationGeneration: lease.operationGeneration,
        operationToken: lease.operationToken,
      });
      const completion = await fulfillAttempt(bindings, recordKey, lease);
      expect(completion.kind).toBe("completed");
      const status = await coordinatorGetStatusByPaymentIdentifier(
        bindings.PAYMENT_COORDINATOR,
        input.paymentIdentifier,
      );
      expect(status?.state).toBe("fulfilled");
    });
  });

  describe("phase-aware orchestrator handling", () => {
    let restoreFetch: () => void;

    beforeEach(() => {
      restoreFetch = installNetworkGuard();
      setCoordinatorFailureInjectionForTests(null);
    });

    afterEach(() => {
      restoreFetch();
      setCoordinatorFailureInjectionForTests(null);
      vi.restoreAllMocks();
    });

    it("verify exception marks verify uncertain only", async () => {
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

    it("compute exception becomes authenticated definitive failure", async () => {
      const { deps, bindings, dispose } = await createMainnetOrchestratorContext({
        buildResponse: () => {
          throw new Error("compute failed");
        },
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

    it("stage RPC exception does not leave permanent undocumented state", async () => {
      const { deps, bindings, dispose } = await createMainnetOrchestratorContext();
      setCoordinatorFailureInjectionForTests({
        stageResponse: () => {
          throw new Error("stage rpc failed");
        },
      });
      const res = await dispatchMainnetPaidRequest(deps);
      expect(res.status).toBe(503);
      const status = await coordinatorGetStatusByPaymentIdentifier(
        bindings.PAYMENT_COORDINATOR,
        MAINNET_TEST_PAYMENT_ID,
      );
      expect(status?.state).toBe("verified");
      await dispose();
    });

    it("settle exception marks settle uncertain only", async () => {
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

    it("post-settlement completion error never marks verify uncertain", async () => {
      const { deps, bindings, dispose } = await createMainnetOrchestratorContext();
      setCoordinatorFailureInjectionForTests({
        completeFulfillment: () => {
          throw new Error("complete failed");
        },
      });
      const res = await dispatchMainnetPaidRequest(deps);
      expect(res.status).toBe(200);
      const status = await coordinatorGetStatusByPaymentIdentifier(
        bindings.PAYMENT_COORDINATOR,
        MAINNET_TEST_PAYMENT_ID,
      );
      expect(status?.state).toBe("uncertain");
      await dispose();
    });

    it("in-progress response omits complete payment ID", async () => {
      const { deps, facilitator, dispose } = await createMainnetOrchestratorContext({
        facilitator: { verifyMode: { delayMs: 500 }, settleMode: { delayMs: 500 } },
      });
      const payload = await buildTestPaymentPayload(deps, {
        paymentIdentifier: MAINNET_TEST_PAYMENT_ID,
      });
      const inFlight = dispatchMainnetPaidRequest(deps, payload);
      await new Promise((resolve) => setTimeout(resolve, 25));
      const duplicate = await dispatchMainnetPaidRequest(deps, payload);
      expect(duplicate.status).toBe(202);
      expect(await duplicate.text()).not.toContain(MAINNET_TEST_PAYMENT_ID);
      const first = await inFlight;
      expect([first.status, duplicate.status]).toContain(200);
      expect(facilitator.counts.verify).toBe(1);
      await dispose();
    });

    it("uncertain response omits complete payment ID", async () => {
      const { deps, dispose } = await createMainnetOrchestratorContext({
        facilitator: { verifyMode: "throw_timeout" },
      });
      const res = await dispatchMainnetPaidRequest(deps);
      const body = await res.text();
      expect(res.status).toBe(503);
      expect(body).not.toContain(MAINNET_TEST_PAYMENT_ID);
      await dispose();
    });
  });

  describe("workerd-safe validator drift guard", () => {
    it("documents workerd-safe tripwire source comment", () => {
      const source = readFileSync(
        path.join(
          projectRoot,
          "src/mainnet/idempotency/payment-identifier-workerd-safe.ts",
        ),
        "utf8",
      );
      expect(source).toContain("test/mainnet-payment-identifier-drift.test.ts");
      expect(source).not.toMatch(/\bimport\s+.*ajv/i);
    });
  });

  describe("CLI error sanitization", () => {
    it("redacts private keys, addresses, payment headers, and API keys", () => {
      const fakeKey = `0x${"ab".repeat(32)}`;
      const fakeAddress = "0x1111111111111111111111111111111111111111";
      const output = formatSafeCliErrorJson({
        stage: "test",
        error: new Error(
          `failed with key ${fakeKey} seller ${fakeAddress} header PAYMENT-SIGNATURE: abc token sk_live_secret https://user:pass@example.com`,
        ),
      });
      expect(output).not.toContain(fakeKey);
      expect(output).not.toContain(fakeAddress);
      expect(output).not.toContain("PAYMENT-SIGNATURE:");
      expect(output).not.toContain("sk_live_secret");
      expect(output).not.toContain("user:pass@");
    });
  });

  describe("structured logging hardening", () => {
    it("allows only explicit safe scalar fields", () => {
      expect(getAllowedLogFieldKeys()).toEqual([
        "requestId",
        "route",
        "method",
        "status",
        "durationMs",
        "upstreamStatus",
        "paymentOutcome",
        "code",
        "message",
      ]);
    });

    it("drops disallowed sensitive fields from structured logs", () => {
      const lines: string[] = [];
      logStructured(
        "info",
        {
          requestId: "r1",
          route: "/v1/example",
          paymentOutcome: "required",
          // @ts-expect-error intentional negative test
          paymentIdentifier: MAINNET_TEST_PAYMENT_ID,
          // @ts-expect-error intentional negative test
          privateKey: "0xabc",
        },
        (line) => lines.push(line),
      );
      expect(lines).toHaveLength(1);
      const parsed = JSON.parse(lines[0]!) as Record<string, unknown>;
      expect(parsed.requestId).toBe("r1");
      expect(parsed.paymentOutcome).toBe("required");
      expect(parsed.paymentIdentifier).toBeUndefined();
      expect(parsed.privateKey).toBeUndefined();
      expect(lines[0]).not.toContain(MAINNET_TEST_PAYMENT_ID);
    });
  });
});
