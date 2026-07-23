import { describe, expect, it, vi } from "vitest";
import {
  BASE_SEPOLIA_MAX_TIMEOUT_SECONDS,
  BASE_SEPOLIA_PAYMENT_AMOUNT,
  BASE_SEPOLIA_USDC_ASSET,
  BASE_SEPOLIA_USDC_EIP712_NAME,
  BASE_SEPOLIA_USDC_EIP712_VERSION,
} from "../src/config.js";
import { createApp } from "../src/index.js";

const testAppOptions = {
  syncFacilitatorOnStart: true,
  useStaticFacilitator: true,
} as const;

describe("payment middleware", () => {
  it("valid unpaid input returns 402 with payment requirements", async () => {
    let handlerRan = false;
    const app = createApp({
      ...testAppOptions,
      onExampleHandlerExecuted: () => {
        handlerRan = true;
      },
    });

    const res = await app.request(
      "http://localhost/v1/example?value=hello",
      { headers: { Accept: "application/json" } },
    );

    expect(res.status).toBe(402);
    expect(handlerRan).toBe(false);

    const paymentRequired =
      res.headers.get("payment-required") ??
      res.headers.get("PAYMENT-REQUIRED");
    expect(paymentRequired).toBeTruthy();

    const decoded = JSON.parse(
      Buffer.from(paymentRequired!, "base64").toString("utf8"),
    ) as {
      x402Version?: number;
      accepts?: Array<{
        network?: string;
        scheme?: string;
        amount?: string;
        asset?: string;
        maxTimeoutSeconds?: number;
        payTo?: string;
        extra?: { name?: string; version?: string };
      }>;
      error?: string;
    };
    expect(decoded.x402Version).toBe(2);
    expect(decoded.accepts?.[0]?.network).toBe("eip155:84532");
    expect(decoded.accepts?.[0]?.scheme).toBe("exact");
    expect(decoded.accepts?.[0]?.amount).toBe(BASE_SEPOLIA_PAYMENT_AMOUNT);
    expect(decoded.accepts?.[0]?.asset?.toLowerCase()).toBe(
      BASE_SEPOLIA_USDC_ASSET.toLowerCase(),
    );
    expect(decoded.accepts?.[0]?.maxTimeoutSeconds).toBeLessThanOrEqual(
      BASE_SEPOLIA_MAX_TIMEOUT_SECONDS,
    );
    expect(decoded.accepts?.[0]?.payTo).toMatch(/^0x[a-fA-F0-9]{40}$/);
    expect(decoded.accepts?.[0]?.extra?.name).toBe(BASE_SEPOLIA_USDC_EIP712_NAME);
    expect(decoded.accepts?.[0]?.extra?.version).toBe(
      BASE_SEPOLIA_USDC_EIP712_VERSION,
    );
    expect(decoded.accepts).toHaveLength(1);

    const body = (await res.json()) as {
      success?: boolean;
      error?: { code?: string };
      accepts?: unknown;
      x402Version?: number;
    };
    expect(body.success).toBe(false);
    expect(body.error?.code).toBe("PAYMENT_REQUIRED");
  });

  it("protected handler does not execute before payment verification", async () => {
    let executions = 0;
    const app = createApp({
      ...testAppOptions,
      onExampleHandlerExecuted: () => {
        executions += 1;
      },
    });

    await app.request("http://localhost/v1/example?value=hello", {
      headers: { Accept: "application/json" },
    });
    await app.request("http://localhost/v1/example?value=");
    await app.request("http://localhost/v1/example");

    expect(executions).toBe(0);
  });
});
