import type { FacilitatorClient } from "@x402/core/server";
import type {
  Network,
  PaymentPayload,
  PaymentRequirements,
  SettleResponse,
  VerifyResponse,
} from "@x402/core/types";
import { MAINNET_NETWORK } from "../payment-policy.mainnet.js";

export type MockVerifyMode =
  | "success"
  | "definitive_failure"
  | "throw_timeout"
  | { delayMs: number; mode?: MockVerifyMode };

export type MockSettleMode =
  | "success"
  | "definitive_failure"
  | "throw_timeout"
  | "malformed_response"
  | { delayMs: number; mode?: MockSettleMode };

export type MockFacilitatorOptions = {
  network?: Network;
  verifyMode?: MockVerifyMode;
  settleMode?: MockSettleMode;
  transactionHash?: string;
};

export type MockFacilitatorCallCounts = {
  verify: number;
  settle: number;
  getSupported: number;
};

export type MockFacilitatorClient = FacilitatorClient & {
  counts: MockFacilitatorCallCounts;
  setVerifyMode: (mode: MockVerifyMode) => void;
  setSettleMode: (mode: MockSettleMode) => void;
};

function resolveDelayedMode<T extends MockVerifyMode | MockSettleMode>(
  mode: T,
): { delayMs: number; inner: T | Exclude<T, { delayMs: number }> } {
  if (typeof mode === "object" && mode !== null && "delayMs" in mode) {
    return {
      delayMs: mode.delayMs,
      inner: (mode.mode ?? "success") as T,
    };
  }
  return { delayMs: 0, inner: mode };
}

async function applyDelay(ms: number): Promise<void> {
  if (ms <= 0) {
    return;
  }
  await new Promise((resolve) => setTimeout(resolve, ms));
}

export function createMockFacilitatorClient(
  options: MockFacilitatorOptions = {},
): MockFacilitatorClient {
  const network = options.network ?? (MAINNET_NETWORK as Network);
  const counts: MockFacilitatorCallCounts = {
    verify: 0,
    settle: 0,
    getSupported: 0,
  };

  let verifyMode: MockVerifyMode = options.verifyMode ?? "success";
  let settleMode: MockSettleMode = options.settleMode ?? "success";
  const transactionHash = options.transactionHash ?? `0x${"ab".repeat(32)}`;

  const client: MockFacilitatorClient = {
    counts,
    setVerifyMode(mode) {
      verifyMode = mode;
    },
    setSettleMode(mode) {
      settleMode = mode;
    },
    async getSupported() {
      counts.getSupported += 1;
      return {
        kinds: [
          {
            x402Version: 2,
            scheme: "exact",
            network,
          },
        ],
        extensions: ["payment-identifier"],
        signers: {
          [network]: ["0x0000000000000000000000000000000000000001"],
        },
      };
    },
    async verify(
      _paymentPayload: PaymentPayload,
      _paymentRequirements: PaymentRequirements,
    ): Promise<VerifyResponse> {
      counts.verify += 1;
      const resolved = resolveDelayedMode(verifyMode);
      await applyDelay(resolved.delayMs);
      const mode = resolved.inner;
      if (mode === "definitive_failure") {
        return {
          isValid: false,
          invalidReason: "mock_verify_invalid",
          invalidMessage: "Mock facilitator rejected payment.",
        };
      }
      if (mode === "throw_timeout") {
        throw new Error("mock_verify_timeout");
      }
      return { isValid: true, payer: "0x1111111111111111111111111111111111111111" };
    },
    async settle(
      _paymentPayload: PaymentPayload,
      _paymentRequirements: PaymentRequirements,
    ): Promise<SettleResponse> {
      counts.settle += 1;
      const resolved = resolveDelayedMode(settleMode);
      await applyDelay(resolved.delayMs);
      const mode = resolved.inner;
      if (mode === "definitive_failure") {
        return {
          success: false,
          errorReason: "mock_settle_failed",
          errorMessage: "Mock facilitator settlement failed.",
          network,
          transaction: "",
        };
      }
      if (mode === "throw_timeout") {
        throw new Error("mock_settle_timeout");
      }
      if (mode === "malformed_response") {
        return {
          success: true,
          transaction: "not-a-hash",
          network: "eip155:1",
        } as SettleResponse;
      }
      return {
        success: true,
        transaction: transactionHash,
        network,
        payer: "0x1111111111111111111111111111111111111111",
        amount: "1000",
      };
    },
  };

  return client;
}
