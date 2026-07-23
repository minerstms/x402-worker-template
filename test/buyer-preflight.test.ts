import { encodePaymentRequiredHeader } from "@x402/core/http";
import type { PaymentRequired } from "@x402/core/types";
import { describe, expect, it, vi } from "vitest";
import { runBuyerPreflight } from "../src/buyer-preflight.js";
import {
  BASE_SEPOLIA,
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

function setBuyerEnv(overrides: Record<string, string> = {}): void {
  process.env.API_URL = REMOTE_API;
  process.env.EXPECTED_REMOTE_API_ORIGIN = REMOTE_ORIGIN;
  process.env.EXPECTED_PAY_TO_ADDRESS = TEST_SELLER;
  process.env.ALLOW_TESTNET_PAYMENT = "true";
  process.env.X402_NETWORK = BASE_SEPOLIA;
  process.env.EVM_PRIVATE_KEY = TEST_KEY;
  for (const [key, value] of Object.entries(overrides)) {
    process.env[key] = value;
  }
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
        payTo: TEST_SELLER,
        extra,
      }),
    ],
  };
}

describe("buyer preflight", () => {
  it("fails when payment requirements omit EIP-712 extra metadata", async () => {
    setBuyerEnv();
    const paymentRequired = buildPaymentRequired({});

    const fetchImpl = vi.fn(async () =>
      Response.json(
        { success: false },
        {
          status: 402,
          headers: {
            "payment-required": encodePaymentRequiredHeader(paymentRequired),
          },
        },
      ),
    );

    const report = await runBuyerPreflight({
      loadEnv: false,
      fetchImpl,
      rpcUrl: "http://mock-rpc.invalid",
    });

    const prerequisite = report.stages.find(
      (stage) => stage.stage === "payment_payload_prerequisites",
    );
    expect(prerequisite?.status).toBe("FAIL");
    expect(report.overall).toBe("FAIL");
    expect(report.liveSigningAttempted).toBe(false);
    expect(report.paidRequestAttempted).toBe(false);
  });

  it("passes mocked guard and unpaid stages without signing", async () => {
    setBuyerEnv();
    const paymentRequired = buildPaymentRequired({
      name: BASE_SEPOLIA_USDC_EIP712_NAME,
      version: BASE_SEPOLIA_USDC_EIP712_VERSION,
    });

    const fetchImpl = vi.fn(async () =>
      Response.json(
        { success: false },
        {
          status: 402,
          headers: {
            "payment-required": encodePaymentRequiredHeader(paymentRequired),
          },
        },
      ),
    );

    const report = await runBuyerPreflight({
      loadEnv: false,
      fetchImpl,
      publicClient: {
        getChainId: async () => 84532,
        readContract: async ({ functionName }) => {
          if (functionName === "decimals") return 6;
          if (functionName === "balanceOf") return 1_000_000n;
          throw new Error(`Unexpected readContract call: ${functionName}`);
        },
      },
    });

    expect(report.overall).toBe("PASS");
  });
});
