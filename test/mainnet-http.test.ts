import { describe, expect, it } from "vitest";
import {
  advanceToSettling,
  createMainnetCoordinatorMiniflare,
  createMainnetTestContext,
  fulfillAttempt,
  prepareCreatedAttempt,
} from "./helpers/mainnet-coordinator-harness.js";

describe("mainnet worker HTTP surface via Miniflare", () => {
  it("health responds on mainnet entry", async () => {
    const mf = await createMainnetCoordinatorMiniflare();
    const res = await mf.dispatchFetch("http://localhost/health");
    expect(res.status).toBe(200);
    const body = (await res.json()) as { success: boolean; status: string };
    expect(body.success).toBe(true);
    expect(body.status).toBe("healthy");
    await mf.dispose();
  });

  it("unknown status returns not_seen", async () => {
    const mf = await createMainnetCoordinatorMiniflare();
    const res = await mf.dispatchFetch(
      "http://localhost/pay/status/pay_unknown00000001",
    );
    expect(res.status).toBe(404);
    expect(await res.json()).toEqual({ state: "not_seen" });
    expect(res.headers.get("Cache-Control")).toBe("no-store");
    await mf.dispose();
  });

  it("status route redacts sensitive fields", async () => {
    const { mf, bindings } = await createMainnetTestContext();
    const { input, recordKey } = await prepareCreatedAttempt(bindings);
    const lease = await advanceToSettling(bindings, recordKey);
    if (lease.kind !== "acquired") {
      throw new Error("Expected acquired settle lease");
    }
    await fulfillAttempt(bindings, recordKey, lease);

    const res = await mf.dispatchFetch(
      `http://localhost/pay/status/${input.paymentIdentifier}`,
    );
    expect(res.status).toBe(200);
    const body = (await res.json()) as Record<string, unknown>;
    expect(body.state).toBe("fulfilled");
    expect(body.updatedAt).toBeTypeOf("string");
    expect(body.transactionReference).toBeTypeOf("string");
    expect(body.result).toEqual({
      contentType: "application/json",
      body: { ok: true, service: "proof" },
    });
    expect(JSON.stringify(body)).not.toContain(input.paymentIdentifier);
    expect(body).not.toHaveProperty("authCommitment");
    expect(body).not.toHaveProperty("operationToken");
    expect(res.headers.get("Cache-Control")).toBe("no-store");
    await mf.dispose();
  });

  it("paid route remains disabled with local message", async () => {
    const mf = await createMainnetCoordinatorMiniflare();
    const res = await mf.dispatchFetch("http://localhost/v1/example?value=demo");
    expect(res.status).toBe(503);
    const body = (await res.json()) as { error: { code: string } };
    expect(body.error.code).toBe("NOT_ENABLED");
    await mf.dispose();
  });
});
