import type { FacilitatorClient } from "@x402/core/server";
import type { Network, PaymentPayload, PaymentRequirements } from "@x402/core/types";
import { HTTPFacilitatorClient } from "@x402/core/server";
import { describe, expect, it, vi } from "vitest";
import {
  BASE_SEPOLIA_MAX_TIMEOUT_SECONDS,
  BASE_SEPOLIA_PAYMENT_AMOUNT,
  BASE_SEPOLIA_USDC_ASSET,
  BASE_SEPOLIA_USDC_EIP712_NAME,
  BASE_SEPOLIA_USDC_EIP712_VERSION,
  DEFAULT_PAY_TO,
} from "../src/config.js";
import { createApp } from "../src/index.js";
import {
  createProductionFacilitatorClient,
} from "../src/payment.js";
import { resolveConfig } from "../src/config.js";

function createHangingFacilitatorClient(): FacilitatorClient {
  const network = "eip155:84532" as Network;
  return {
    getSupported: vi.fn<FacilitatorClient["getSupported"]>(
      () => new Promise(() => {}),
    ),
    verify: vi.fn(async () => ({
      isValid: false,
      invalidReason: "not_called_in_unpaid_test",
    })),
    settle: vi.fn(async () => ({
      success: false,
      errorReason: "not_called_in_unpaid_test",
      errorMessage: "not_called_in_unpaid_test",
      network,
      transaction: "",
    })),
  };
}

const productionLikeOptions = {
  syncFacilitatorOnStart: false,
  useStaticFacilitator: false,
  env: {
    X402_PAY_TO_ADDRESS: DEFAULT_PAY_TO,
  },
} as const;

describe("facilitator startup and unpaid 402", () => {
  it("returns 402 promptly without live facilitator discovery", async () => {
    const hangingFetch = vi.fn(() => new Promise(() => {}));
    vi.stubGlobal("fetch", hangingFetch);

    try {
      const app = createApp(productionLikeOptions);

      const started = Date.now();
      const res = await app.request(
        "http://localhost/v1/example?value=hello",
        { headers: { Accept: "application/json" } },
      );
      const elapsedMs = Date.now() - started;

      expect(res.status).toBe(402);
      expect(elapsedMs).toBeLessThan(2_000);
      expect(hangingFetch).not.toHaveBeenCalled();
    } finally {
      vi.unstubAllGlobals();
    }
  });

  it("defaults startup sync to disabled for unpaid 402", async () => {
    const hangingFetch = vi.fn(() => new Promise(() => {}));
    vi.stubGlobal("fetch", hangingFetch);

    try {
      const app = createApp({
        useStaticFacilitator: false,
        env: {
          X402_PAY_TO_ADDRESS: DEFAULT_PAY_TO,
        },
      });

      const res = await app.request(
        "http://localhost/v1/example?value=hello",
        { headers: { Accept: "application/json" } },
      );

      expect(res.status).toBe(402);
      expect(hangingFetch).not.toHaveBeenCalled();
    } finally {
      vi.unstubAllGlobals();
    }
  });

  it("waits on facilitator discovery when sync is explicitly enabled with a hanging client", async () => {
    const facilitator = createHangingFacilitatorClient();
    const app = createApp({
      syncFacilitatorOnStart: true,
      useStaticFacilitator: false,
      facilitatorClient: facilitator,
      env: {
        X402_PAY_TO_ADDRESS: DEFAULT_PAY_TO,
      },
    });

    const requestPromise = app.request(
      "http://localhost/v1/example?value=hello",
      { headers: { Accept: "application/json" } },
    );

    await expect(
      Promise.race([
        requestPromise,
        new Promise((_, reject) =>
          setTimeout(() => reject(new Error("timed out waiting for 402")), 500),
        ),
      ]),
    ).rejects.toThrow("timed out waiting for 402");
    expect(facilitator.getSupported).toHaveBeenCalled();
  });

  it("uses local supported kinds in the production facilitator client", async () => {
    const config = resolveConfig({
      X402_PAY_TO_ADDRESS: DEFAULT_PAY_TO,
    });
    const client = createProductionFacilitatorClient(config);
    const supported = await client.getSupported();

    expect(supported.kinds).toEqual([
      {
        x402Version: 2,
        scheme: "exact",
        network: "eip155:84532",
      },
    ]);
    expect(supported.extensions).toContain("bazaar");
  });

  it("still emits exact Base Sepolia payment terms without live discovery", async () => {
    vi.stubGlobal("fetch", vi.fn(() => new Promise(() => {})));

    try {
      const app = createApp(productionLikeOptions);

      const res = await app.request(
        "http://localhost/v1/example?value=hello",
        { headers: { Accept: "application/json" } },
      );

      const paymentRequired =
        res.headers.get("payment-required") ??
        res.headers.get("PAYMENT-REQUIRED");
      expect(paymentRequired).toBeTruthy();

      const decoded = JSON.parse(
        Buffer.from(paymentRequired!, "base64").toString("utf8"),
      ) as {
        accepts?: Array<{
          scheme?: string;
          network?: string;
          amount?: string;
          asset?: string;
          maxTimeoutSeconds?: number;
          payTo?: string;
          extra?: { name?: string; version?: string };
        }>;
      };

      expect(decoded.accepts).toHaveLength(1);
      expect(decoded.accepts?.[0]?.scheme).toBe("exact");
      expect(decoded.accepts?.[0]?.network).toBe("eip155:84532");
      expect(decoded.accepts?.[0]?.amount).toBe(BASE_SEPOLIA_PAYMENT_AMOUNT);
      expect(decoded.accepts?.[0]?.asset?.toLowerCase()).toBe(
        BASE_SEPOLIA_USDC_ASSET.toLowerCase(),
      );
      expect(decoded.accepts?.[0]?.maxTimeoutSeconds).toBe(
        BASE_SEPOLIA_MAX_TIMEOUT_SECONDS,
      );
      expect(decoded.accepts?.[0]?.payTo?.toLowerCase()).toBe(
        DEFAULT_PAY_TO.toLowerCase(),
      );
      expect(decoded.accepts?.[0]?.extra?.name).toBe(
        BASE_SEPOLIA_USDC_EIP712_NAME,
      );
      expect(decoded.accepts?.[0]?.extra?.version).toBe(
        BASE_SEPOLIA_USDC_EIP712_VERSION,
      );
    } finally {
      vi.unstubAllGlobals();
    }
  });

  it("keeps free routes working without live facilitator discovery", async () => {
    vi.stubGlobal("fetch", vi.fn(() => new Promise(() => {})));

    try {
      const app = createApp(productionLikeOptions);

      const health = await app.request("http://localhost/health");
      const openApi = await app.request("http://localhost/openapi.json");

      expect(health.status).toBe(200);
      expect(openApi.status).toBe(200);
    } finally {
      vi.unstubAllGlobals();
    }
  });

  it("validates invalid value before payment handling", async () => {
    const app = createApp(productionLikeOptions);

    const res = await app.request(
      "http://localhost/v1/example?value=",
      { headers: { Accept: "application/json" } },
    );

    expect(res.status).toBe(400);
  });

  it("delegates verify to the live HTTP facilitator", async () => {
    const config = resolveConfig({
      X402_PAY_TO_ADDRESS: DEFAULT_PAY_TO,
    });
    const verify = vi
      .spyOn(HTTPFacilitatorClient.prototype, "verify")
      .mockResolvedValue({
        isValid: false,
        invalidReason: "test_verify",
      });
    const client = createProductionFacilitatorClient(config);
    const requirements = {
      scheme: "exact",
      network: "eip155:84532" as Network,
      amount: BASE_SEPOLIA_PAYMENT_AMOUNT,
      asset: BASE_SEPOLIA_USDC_ASSET,
      payTo: DEFAULT_PAY_TO,
      maxTimeoutSeconds: BASE_SEPOLIA_MAX_TIMEOUT_SECONDS,
      extra: {},
    } satisfies PaymentRequirements;

    await client.verify(
      {
        x402Version: 2,
        scheme: "exact",
        network: "eip155:84532",
        payload: {},
      } as unknown as PaymentPayload,
      requirements,
    );

    expect(verify).toHaveBeenCalled();
    verify.mockRestore();
  });
});
