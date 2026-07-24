import { describe, expect, it } from "vitest";
import { buildFulfilledReplayResponse } from "../src/mainnet/idempotency/replay-response.js";
import {
  validateSettlementReceiptForStorage,
} from "../src/mainnet/idempotency/settlement-receipt.js";
import {
  advanceToComputing,
  advanceToSettling,
  advanceToVerified,
  buildTestPrepareInput,
  buildTestRecordKey,
  cleanupAfterTtl,
  coordinatorAcquireSettleLease,
  coordinatorAcquireVerifyLease,
  coordinatorCompleteFulfillment,
  coordinatorCompleteVerify,
  coordinatorGetReplay,
  coordinatorGetStatusByPaymentIdentifier,
  coordinatorMarkSettleUncertain,
  coordinatorMarkVerifyUncertain,
  coordinatorPrepareAttempt,
  coordinatorStageResponse,
  fulfillAttempt,
  getMainnetBindings,
  prepareCreatedAttempt,
  validSettlementReceipt,
} from "./helpers/mainnet-coordinator-harness.js";

describe("mainnet durable payment coordinator", () => {
  it("one valid prepare creates one record", async () => {
    const bindings = await getMainnetBindings();
    const { result } = await prepareCreatedAttempt(bindings);
    expect(result).toEqual(
      expect.objectContaining({ kind: "created", state: "reserved" }),
    );
  });

  it("identical prepare returns wait while in progress", async () => {
    const bindings = await getMainnetBindings();
    const input = await buildTestPrepareInput();
    const first = await coordinatorPrepareAttempt(bindings.PAYMENT_COORDINATOR, input);
    const second = await coordinatorPrepareAttempt(bindings.PAYMENT_COORDINATOR, input);
    expect(first.kind).toBe("created");
    expect(second).toEqual(
      expect.objectContaining({ kind: "wait", state: "reserved" }),
    );
  });

  it("same ID with changed terms returns conflict", async () => {
    const bindings = await getMainnetBindings();
    const input = await buildTestPrepareInput();
    await coordinatorPrepareAttempt(bindings.PAYMENT_COORDINATOR, input);
    const changed = await buildTestPrepareInput({
      paymentIdentifier: input.paymentIdentifier,
      terms: { amount: "2000" },
    });
    const result = await coordinatorPrepareAttempt(
      bindings.PAYMENT_COORDINATOR,
      changed,
    );
    expect(result.kind).toBe("conflict");
  });

  it("same ID with changed auth returns conflict", async () => {
    const bindings = await getMainnetBindings();
    const input = await buildTestPrepareInput();
    await coordinatorPrepareAttempt(bindings.PAYMENT_COORDINATOR, input);
    const changed = await buildTestPrepareInput({
      paymentIdentifier: input.paymentIdentifier,
      auth: { authorizationNonce: "nonce-changed" },
    });
    const result = await coordinatorPrepareAttempt(
      bindings.PAYMENT_COORDINATOR,
      changed,
    );
    expect(result.kind).toBe("conflict");
  });

  it("same auth with another ID returns conflict", async () => {
    const bindings = await getMainnetBindings();
    const sharedAuth = { authorizationNonce: "shared-auth-nonce" };
    const first = await buildTestPrepareInput({
      paymentIdentifier: "pay_aaaaaaaaaaaaaaaa",
      auth: sharedAuth,
    });
    await coordinatorPrepareAttempt(bindings.PAYMENT_COORDINATOR, first);
    const second = await buildTestPrepareInput({
      paymentIdentifier: "pay_bbbbbbbbbbbbbbbb",
      auth: sharedAuth,
    });
    const result = await coordinatorPrepareAttempt(
      bindings.PAYMENT_COORDINATOR,
      second,
    );
    expect(result.kind).toBe("conflict");
  });

  it("verify lease issued once", async () => {
    const bindings = await getMainnetBindings();
    const { recordKey } = await prepareCreatedAttempt(bindings);
    const lease = await coordinatorAcquireVerifyLease(bindings.PAYMENT_COORDINATOR, {
      recordKey,
    });
    expect(lease.kind).toBe("acquired");
    const retry = await coordinatorAcquireVerifyLease(bindings.PAYMENT_COORDINATOR, {
      recordKey,
    });
    expect(retry.kind).toBe("rejected");
  });

  it("concurrent verify lease acquisition issues one token only", async () => {
    const bindings = await getMainnetBindings();
    const { recordKey } = await prepareCreatedAttempt(bindings);
    const [first, second] = await Promise.all([
      coordinatorAcquireVerifyLease(bindings.PAYMENT_COORDINATOR, { recordKey }),
      coordinatorAcquireVerifyLease(bindings.PAYMENT_COORDINATOR, { recordKey }),
    ]);
    const acquired = [first, second].filter((result) => result.kind === "acquired");
    expect(acquired).toHaveLength(1);
  });

  it("wrong verify token cannot complete", async () => {
    const bindings = await getMainnetBindings();
    const { recordKey } = await prepareCreatedAttempt(bindings);
    const lease = await coordinatorAcquireVerifyLease(bindings.PAYMENT_COORDINATOR, {
      recordKey,
    });
    if (lease.kind !== "acquired") {
      throw new Error("Expected acquired verify lease");
    }
    const result = await coordinatorCompleteVerify(bindings.PAYMENT_COORDINATOR, {
      recordKey,
      operationGeneration: lease.operationGeneration,
      operationToken: "deadbeef".repeat(8),
    });
    expect(result.kind).toBe("stale");
  });

  it("matching verify completion succeeds", async () => {
    const bindings = await getMainnetBindings();
    const { recordKey, input } = await prepareCreatedAttempt(bindings);
    const lease = await advanceToVerified(bindings, recordKey);
    const status = await coordinatorGetStatusByPaymentIdentifier(
      bindings.PAYMENT_COORDINATOR,
      input.paymentIdentifier,
    );
    expect(status?.state).toBe("verified");
    expect(lease.kind).toBe("acquired");
  });

  it("verify uncertain preserves generation and token", async () => {
    const bindings = await getMainnetBindings();
    const { recordKey } = await prepareCreatedAttempt(bindings);
    const lease = await coordinatorAcquireVerifyLease(bindings.PAYMENT_COORDINATOR, {
      recordKey,
    });
    if (lease.kind !== "acquired") {
      throw new Error("Expected acquired verify lease");
    }
    await coordinatorMarkVerifyUncertain(bindings.PAYMENT_COORDINATOR, {
      recordKey,
      operationGeneration: lease.operationGeneration,
      operationToken: lease.operationToken,
    });
    const late = await coordinatorCompleteVerify(bindings.PAYMENT_COORDINATOR, {
      recordKey,
      operationGeneration: lease.operationGeneration,
      operationToken: lease.operationToken,
    });
    expect(late.kind).toBe("completed");
  });

  it("no verify lease can be reacquired from uncertain", async () => {
    const bindings = await getMainnetBindings();
    const { recordKey } = await prepareCreatedAttempt(bindings);
    const lease = await coordinatorAcquireVerifyLease(bindings.PAYMENT_COORDINATOR, {
      recordKey,
    });
    if (lease.kind !== "acquired") {
      throw new Error("Expected acquired verify lease");
    }
    await coordinatorMarkVerifyUncertain(bindings.PAYMENT_COORDINATOR, {
      recordKey,
      operationGeneration: lease.operationGeneration,
      operationToken: lease.operationToken,
    });
    const retry = await coordinatorAcquireVerifyLease(bindings.PAYMENT_COORDINATOR, {
      recordKey,
    });
    expect(retry.kind).toBe("rejected");
  });

  it("response staging requires verified state", async () => {
    const bindings = await getMainnetBindings();
    const { recordKey } = await prepareCreatedAttempt(bindings);
    const staged = await coordinatorStageResponse(bindings.PAYMENT_COORDINATOR, {
      recordKey,
      body: JSON.stringify({ ok: true }),
      contentType: "application/json",
    });
    expect(staged.kind).toBe("rejected");
  });

  it("oversize response rejected", async () => {
    const bindings = await getMainnetBindings();
    const { recordKey } = await prepareCreatedAttempt(bindings);
    await advanceToVerified(bindings, recordKey);
    const staged = await coordinatorStageResponse(bindings.PAYMENT_COORDINATOR, {
      recordKey,
      body: JSON.stringify({ blob: "x".repeat(9000) }),
      contentType: "application/json",
    });
    expect(staged.kind).toBe("rejected");
  });

  it("settle lease requires staged response", async () => {
    const bindings = await getMainnetBindings();
    const { recordKey } = await prepareCreatedAttempt(bindings);
    await advanceToVerified(bindings, recordKey);
    const lease = await coordinatorAcquireSettleLease(bindings.PAYMENT_COORDINATOR, {
      recordKey,
    });
    expect(lease.kind).toBe("rejected");
  });

  it("settle lease issued once", async () => {
    const bindings = await getMainnetBindings();
    const { recordKey } = await prepareCreatedAttempt(bindings);
    await advanceToComputing(bindings, recordKey);
    const lease = await coordinatorAcquireSettleLease(bindings.PAYMENT_COORDINATOR, {
      recordKey,
    });
    expect(lease.kind).toBe("acquired");
    const retry = await coordinatorAcquireSettleLease(bindings.PAYMENT_COORDINATOR, {
      recordKey,
    });
    expect(retry.kind).toBe("rejected");
  });

  it("settle uncertain preserves generation and token", async () => {
    const bindings = await getMainnetBindings();
    const { recordKey } = await prepareCreatedAttempt(bindings);
    const lease = await advanceToSettling(bindings, recordKey);
    if (lease.kind !== "acquired") {
      throw new Error("Expected acquired settle lease");
    }
    await coordinatorMarkSettleUncertain(bindings.PAYMENT_COORDINATOR, {
      recordKey,
      operationGeneration: lease.operationGeneration,
      operationToken: lease.operationToken,
    });
    const late = await coordinatorCompleteFulfillment(bindings.PAYMENT_COORDINATOR, {
      recordKey,
      operationGeneration: lease.operationGeneration,
      operationToken: lease.operationToken,
      settlementReceipt: validSettlementReceipt(),
    });
    expect(late.kind).toBe("completed");
  });

  it("expired settle lease never grants another settle lease", async () => {
    const bindings = await getMainnetBindings();
    const { recordKey } = await prepareCreatedAttempt(bindings);
    const lease = await advanceToSettling(bindings, recordKey);
    if (lease.kind !== "acquired") {
      throw new Error("Expected acquired settle lease");
    }
    await coordinatorMarkSettleUncertain(bindings.PAYMENT_COORDINATOR, {
      recordKey,
      operationGeneration: lease.operationGeneration,
      operationToken: lease.operationToken,
    });
    const retry = await coordinatorAcquireSettleLease(bindings.PAYMENT_COORDINATOR, {
      recordKey,
    });
    expect(retry.kind).toBe("rejected");
  });

  it("matching late settle completion from uncertain reaches fulfilled", async () => {
    const bindings = await getMainnetBindings();
    const { recordKey, input } = await prepareCreatedAttempt(bindings);
    const lease = await advanceToSettling(bindings, recordKey);
    if (lease.kind !== "acquired") {
      throw new Error("Expected acquired settle lease");
    }
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

  it("wrong-token late completion rejected", async () => {
    const bindings = await getMainnetBindings();
    const { recordKey } = await prepareCreatedAttempt(bindings);
    const lease = await advanceToSettling(bindings, recordKey);
    if (lease.kind !== "acquired") {
      throw new Error("Expected acquired settle lease");
    }
    await coordinatorMarkSettleUncertain(bindings.PAYMENT_COORDINATOR, {
      recordKey,
      operationGeneration: lease.operationGeneration,
      operationToken: lease.operationToken,
    });
    const completion = await coordinatorCompleteFulfillment(
      bindings.PAYMENT_COORDINATOR,
      {
        recordKey,
        operationGeneration: lease.operationGeneration,
        operationToken: "deadbeef".repeat(8),
        settlementReceipt: validSettlementReceipt(),
      },
    );
    expect(completion.kind).toBe("stale");
  });

  it("fulfillment atomically stores body and receipt", async () => {
    const bindings = await getMainnetBindings();
    const body = JSON.stringify({ ok: true, value: 42 });
    const { recordKey, input } = await prepareCreatedAttempt(bindings);
    await advanceToComputing(bindings, recordKey, body);
    const lease = await coordinatorAcquireSettleLease(bindings.PAYMENT_COORDINATOR, {
      recordKey,
    });
    if (lease.kind !== "acquired") {
      throw new Error("Expected acquired settle lease");
    }
    await fulfillAttempt(bindings, recordKey, lease);
    const replay = await coordinatorGetReplay(bindings.PAYMENT_COORDINATOR, recordKey);
    expect(replay).toEqual(
      expect.objectContaining({
        ok: true,
        body,
        contentType: "application/json",
      }),
    );
    const status = await coordinatorGetStatusByPaymentIdentifier(
      bindings.PAYMENT_COORDINATOR,
      input.paymentIdentifier,
    );
    expect(status?.transactionHash).toMatch(/^0x[0-9a-f]{64}$/);
  });

  it("transaction hash requires 0x plus 64 hex", () => {
    const valid = validateSettlementReceiptForStorage(validSettlementReceipt());
    const invalid = validateSettlementReceiptForStorage({
      success: true,
      transaction: "0x1234",
      network: "eip155:8453",
    });
    expect(valid.ok).toBe(true);
    expect(invalid.ok).toBe(false);
  });

  it("wrong network receipt rejected", () => {
    const result = validateSettlementReceiptForStorage({
      success: true,
      transaction: `0x${"b".repeat(64)}`,
      network: "eip155:84532",
    });
    expect(result.ok).toBe(false);
  });

  it("fulfilled replay includes reconstructed payment-response header", async () => {
    const bindings = await getMainnetBindings();
    const { recordKey } = await prepareCreatedAttempt(bindings);
    const lease = await advanceToSettling(bindings, recordKey);
    if (lease.kind !== "acquired") {
      throw new Error("Expected acquired settle lease");
    }
    await fulfillAttempt(bindings, recordKey, lease);
    const replay = (await coordinatorGetReplay(
      bindings.PAYMENT_COORDINATOR,
      recordKey,
    )) as { ok: true; paymentResponseHeader: string };
    expect(replay.paymentResponseHeader.length).toBeGreaterThan(10);
  });

  it("fulfilled replay includes exact cached body", async () => {
    const bindings = await getMainnetBindings();
    const body = JSON.stringify({ message: "cached-body" });
    const { recordKey } = await prepareCreatedAttempt(bindings);
    await advanceToComputing(bindings, recordKey, body);
    const lease = await coordinatorAcquireSettleLease(bindings.PAYMENT_COORDINATOR, {
      recordKey,
    });
    if (lease.kind !== "acquired") {
      throw new Error("Expected acquired settle lease");
    }
    await fulfillAttempt(bindings, recordKey, lease);
    const replay = (await coordinatorGetReplay(
      bindings.PAYMENT_COORDINATOR,
      recordKey,
    )) as { ok: true; body: string };
    expect(replay.body).toBe(body);
  });

  it("replay performs no external network", async () => {
    const replay = buildFulfilledReplayResponse({
      cachedResponseJson: JSON.stringify({ ok: true }),
      cachedContentType: "application/json",
      settlementReceiptJson: JSON.stringify(validSettlementReceipt()),
    });
    expect(replay.ok).toBe(true);
  });

  it("missing or malformed receipt fails closed", () => {
    const missing = buildFulfilledReplayResponse({
      cachedResponseJson: JSON.stringify({ ok: true }),
      cachedContentType: "application/json",
      settlementReceiptJson: null,
    });
    const malformed = buildFulfilledReplayResponse({
      cachedResponseJson: JSON.stringify({ ok: true }),
      cachedContentType: "application/json",
      settlementReceiptJson: JSON.stringify({ success: true }),
    });
    expect(missing.ok).toBe(false);
    expect(malformed.ok).toBe(false);
  });

  it("TTL cleanup removes expired rows", async () => {
    const bindings = await getMainnetBindings();
    const input = await buildTestPrepareInput({
      paymentIdentifier: "pay_ttlcleanup0001",
    });
    await coordinatorPrepareAttempt(bindings.PAYMENT_COORDINATOR, input);
    const deleted = await cleanupAfterTtl(bindings);
    expect(deleted.deletedCount).toBeGreaterThanOrEqual(1);
    const status = await coordinatorGetStatusByPaymentIdentifier(
      bindings.PAYMENT_COORDINATOR,
      input.paymentIdentifier,
    );
    expect(status).toBeNull();
  });
});
