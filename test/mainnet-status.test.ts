/// <reference path="../worker-configuration.mainnet.d.ts" />

import { describe, expect, it } from "vitest";
import { buildSafePaymentStatusBody } from "../src/mainnet/routes/pay-status.js";
import { validSettlementReceipt } from "./helpers/mainnet-coordinator-harness.js";

describe("mainnet payment status helpers", () => {
  it("uncertain status has canRetry false", () => {
    const body = buildSafePaymentStatusBody({
      state: "uncertain",
      updatedAt: new Date().toISOString(),
      transactionHash: validSettlementReceipt().transaction,
    });
    expect(body.canRetry).toBe(false);
    expect(body.state).toBe("uncertain");
  });

  it("fulfilled status may show shortened transaction reference only", () => {
    const tx = validSettlementReceipt().transaction;
    const body = buildSafePaymentStatusBody({
      state: "fulfilled",
      updatedAt: new Date().toISOString(),
      transactionHash: tx,
    });
    expect(body.transactionRef).toBe(`${tx.slice(0, 8)}…${tx.slice(-6)}`);
    expect(body.transactionRef).not.toBe(tx);
  });
});
