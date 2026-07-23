import { encodePaymentRequiredHeader } from "@x402/core/http";
import type { PaymentPayload, PaymentRequired } from "@x402/core/types";
import { describe, expect, it, vi } from "vitest";
import { runBuyerPayment } from "../src/buyer-run.js";
import {
  BASE_SEPOLIA,
  BASE_SEPOLIA_USDC_ASSET,
  requirement,
} from "../src/buyer-guards.js";
import {
  BASE_SEPOLIA_USDC_EIP712_NAME,
  BASE_SEPOLIA_USDC_EIP712_VERSION,
} from "../src/config.js";

const TEST_KEY = "0x" + "11".repeat(32);
const TEST_SELLER = "0x000000000000000000000000000000000000dEaD";
const REMOTE_ORIGIN =
  "https://x402-worker-template.example-subdomain.workers.dev";
const REMOTE_API = `${REMOTE_ORIGIN}/v1/example?value=hello`;

function setBuyerEnv(): void {
  process.env.API_URL = REMOTE_API;
  process.env.EXPECTED_REMOTE_API_ORIGIN = REMOTE_ORIGIN;
  process.env.EXPECTED_PAY_TO_ADDRESS = TEST_SELLER;
  process.env.ALLOW_TESTNET_PAYMENT = "true";
  process.env.X402_NETWORK = BASE_SEPOLIA;
  process.env.EVM_PRIVATE_KEY = TEST_KEY;
}

function buildPaymentRequired(extra: Record<string, unknown>): PaymentRequired {
  return {
    x402Version: 2,
    resource: {
      url: REMOTE_API,
      mimeType: "application/json",
    },
    accepts: [
      requirement({
        asset: BASE_SEPOLIA_USDC_ASSET,
        payTo: TEST_SELLER,
        extra,
      }),
    ],
  };
}

describe("mocked buyer payment path", () => {
  it("fails before paid submission when EIP-712 extra metadata is missing", async () => {
    setBuyerEnv();
    const fetchImpl = vi.fn(async () =>
      Response.json(
        { success: false },
        {
          status: 402,
          headers: {
            "payment-required": encodePaymentRequiredHeader(
              buildPaymentRequired({}),
            ),
          },
        },
      ),
    );

    const result = await runBuyerPayment({ loadEnv: false, fetchImpl });
    expect(result.ok).toBe(false);
    if (result.ok) return;

    expect(result.report.diagnostic.stage).toBe("create_payment_payload");
    expect(result.report.diagnostic.failurePhase).toBe("during_local_signing");
    expect(result.report.diagnostic.paymentBearingRequestLikelySent).toBe(false);
    expect(result.report.diagnostic.message).toMatch(
      /filtered out by policies|EIP-712 domain parameters/i,
    );
    expect(fetchImpl).toHaveBeenCalledTimes(1);
  });

  it("reaches the intercepted paid retry with exact Base Sepolia terms", async () => {
    setBuyerEnv();
    let callCount = 0;
    const fetchImpl = vi.fn(async (input, init) => {
      callCount += 1;
      if (callCount === 1) {
        return Response.json(
          { success: false },
          {
            status: 402,
            headers: {
              "payment-required": encodePaymentRequiredHeader(
                buildPaymentRequired({
                  name: BASE_SEPOLIA_USDC_EIP712_NAME,
                  version: BASE_SEPOLIA_USDC_EIP712_VERSION,
                }),
              ),
            },
          },
        );
      }

      const request = input instanceof Request ? input : new Request(input, init);
      const paymentHeader =
        request.headers.get("payment-signature") ??
        request.headers.get("PAYMENT-SIGNATURE");
      expect(paymentHeader).toBeTruthy();
      expect(request.url).toBe(REMOTE_API);
      const headerSnapshot: Record<string, string> = {};
      request.headers.forEach((value, key) => {
        headerSnapshot[key] = value;
      });
      expect(JSON.stringify(headerSnapshot)).not.toMatch(/8453[^2]/);

      return Response.json(
        {
          success: true,
          input: "hello",
          normalizedInput: "hello",
          characterCount: 5,
        },
        { status: 200 },
      );
    });

    const result = await runBuyerPayment({ loadEnv: false, fetchImpl });
    expect(result.ok).toBe(true);
    if (!result.ok) return;

    expect(result.status).toBe(200);
    expect(fetchImpl).toHaveBeenCalledTimes(2);
    const secondCall = fetchImpl.mock.calls[1]?.[0];
    const paidRequest =
      secondCall instanceof Request ? secondCall : new Request(secondCall);
    expect(paidRequest.headers.get("payment-signature")).toBeTruthy();
  });

  it("reports guard failures before account construction", async () => {
    setBuyerEnv();
    delete process.env.EXPECTED_REMOTE_API_ORIGIN;

    const result = await runBuyerPayment({ loadEnv: false, fetchImpl: vi.fn() });
    expect(result.ok).toBe(false);
    if (result.ok) return;

    expect(result.report.diagnostic.stage).toBe("validate_guards");
    expect(result.report.diagnostic.failurePhase).toBe("before_account_construction");
  });
});

describe("mocked payment payload construction", () => {
  it("signs a test-only payload when EIP-712 metadata is present", async () => {
    setBuyerEnv();
    const { privateKeyToAccount } = await import("viem/accounts");
    const { ExactEvmScheme } = await import("@x402/evm/exact/client");
    const account = privateKeyToAccount(TEST_KEY as `0x${string}`);
    const scheme = new ExactEvmScheme(account);
    const payload = await scheme.createPaymentPayload(
      2,
      requirement({
        asset: BASE_SEPOLIA_USDC_ASSET,
        payTo: TEST_SELLER,
        extra: {
          name: BASE_SEPOLIA_USDC_EIP712_NAME,
          version: BASE_SEPOLIA_USDC_EIP712_VERSION,
        },
      }),
    );

    expect(payload.x402Version).toBe(2);
    expect((payload as PaymentPayload & { payload?: { signature?: string } }).payload?.signature).toBeTruthy();
  });

  it("produces different signatures when EIP-712 domain name or version is wrong", async () => {
    setBuyerEnv();
    const { privateKeyToAccount } = await import("viem/accounts");
    const { ExactEvmScheme } = await import("@x402/evm/exact/client");
    const account = privateKeyToAccount(TEST_KEY as `0x${string}`);
    const scheme = new ExactEvmScheme(account);
    const baseRequirement = requirement({
      asset: BASE_SEPOLIA_USDC_ASSET,
      payTo: TEST_SELLER,
      extra: {
        name: BASE_SEPOLIA_USDC_EIP712_NAME,
        version: BASE_SEPOLIA_USDC_EIP712_VERSION,
      },
    });

    const correct = await scheme.createPaymentPayload(2, baseRequirement);
    const wrongName = await scheme.createPaymentPayload(
      2,
      requirement({
        ...baseRequirement,
        extra: { name: "WrongName", version: BASE_SEPOLIA_USDC_EIP712_VERSION },
      }),
    );
    const wrongVersion = await scheme.createPaymentPayload(
      2,
      requirement({
        ...baseRequirement,
        extra: { name: BASE_SEPOLIA_USDC_EIP712_NAME, version: "9" },
      }),
    );

    const correctSig = (correct as PaymentPayload & { payload?: { signature?: string } })
      .payload?.signature;
    const wrongNameSig = (wrongName as PaymentPayload & { payload?: { signature?: string } })
      .payload?.signature;
    const wrongVersionSig = (
      wrongVersion as PaymentPayload & { payload?: { signature?: string } }
    ).payload?.signature;

    expect(correctSig).toBeTruthy();
    expect(wrongNameSig).toBeTruthy();
    expect(wrongVersionSig).toBeTruthy();
    expect(wrongNameSig).not.toBe(correctSig);
    expect(wrongVersionSig).not.toBe(correctSig);
  });
});
