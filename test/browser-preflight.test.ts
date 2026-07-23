import { describe, expect, it, vi } from "vitest";
import {
  BASE_SEPOLIA_MAX_TIMEOUT_SECONDS,
  BASE_SEPOLIA_PAYMENT_AMOUNT,
  BASE_SEPOLIA_USDC_ASSET,
  BASE_SEPOLIA_USDC_EIP712_NAME,
  BASE_SEPOLIA_USDC_EIP712_VERSION,
  DEFAULT_PAY_TO,
  resolveConfig,
} from "../src/config.js";
import { buildPayPublicConfig } from "../src/pay-public-config.js";
import { loadAndValidatePaymentTerms } from "../src/browser/terms-loader.js";
import {
  classifyProviderError,
  containsPrivateData,
  sanitizeProviderErrorMessage,
} from "../src/browser/sanitize-error.js";
import {
  canStartAction,
  clearValidatedTermsOnAccountChange,
  clearValidatedTermsOnChainChange,
  deriveWalletState,
  isSigningMethod,
  type PaymentSummary,
  type WalletControllerState,
} from "../src/browser/pay-wallet-state.js";
import { createApp } from "../src/index.js";
import { createPaymentMiddleware } from "../src/payment.js";

function baseState(
  overrides: Partial<WalletControllerState> = {},
): WalletControllerState {
  return {
    hasProvider: true,
    account: "0x1111111111111111111111111111111111111111",
    chainId: 84532,
    expectedChainId: 84532,
    validatedTerms: null,
    pendingAction: null,
    userRejected: false,
    errorMessage: null,
    ...overrides,
  };
}

const summary: PaymentSummary = {
  paying: "0.001 test USDC",
  network: "Base Sepolia testnet",
  service: "/v1/example",
  input: "browser-demo",
  sellerStatus: "placeholder",
  tokenStatus: "verified",
  amountStatus: "verified",
  eip712Status: "verified",
  timeoutStatus: "verified",
  optionsCount: 1,
  renewal: "none",
  requestsAuthorized: 0,
};

function encodePaymentRequired(
  accepts: Array<Record<string, unknown>>,
): string {
  return Buffer.from(JSON.stringify({ accepts }), "utf8").toString("base64");
}

function unpaidResponse(header: string): Response {
  return new Response("{}", {
    status: 402,
    headers: { "payment-required": header },
  });
}

describe("wallet state machine", () => {
  it("handles wallet unavailable state", () => {
    expect(deriveWalletState(baseState({ hasProvider: false }))).toBe(
      "wallet-unavailable",
    );
  });

  it("clears validated terms on account change", () => {
    expect(
      clearValidatedTermsOnAccountChange("0xaaa", "0xbbb", summary),
    ).toBeNull();
  });

  it("clears validated terms on chain change", () => {
    expect(clearValidatedTermsOnChainChange(84532, 1, summary)).toBeNull();
  });

  it("prevents double action while busy", () => {
    const state = baseState({ pendingAction: "connect" });
    expect(canStartAction(state, "connect")).toBe(false);
    expect(canStartAction(state, "load-terms")).toBe(false);
  });

  it("sanitizes connection rejection", () => {
    const result = classifyProviderError({ code: 4001, message: "User rejected" });
    expect(result.kind).toBe("rejected");
    expect(result.message).not.toContain("0x");
  });

  it("does not treat signing methods as allowed actions", () => {
    expect(isSigningMethod("eth_signTypedData_v4")).toBe(true);
    expect(isSigningMethod("eth_chainId")).toBe(false);
  });
});

describe("read-only 402 validation", () => {
  const publicConfig = buildPayPublicConfig(
    resolveConfig({ X402_PAY_TO_ADDRESS: DEFAULT_PAY_TO }),
  );

  it("accepts exact valid 402 terms", async () => {
    const app = createApp({
      syncFacilitatorOnStart: false,
      useStaticFacilitator: true,
      env: { X402_PAY_TO_ADDRESS: DEFAULT_PAY_TO },
    });
    const unpaid = await app.request(
      "http://localhost/v1/example?value=browser-demo",
      { headers: { Accept: "application/json" } },
    );
    expect(unpaid.status).toBe(402);

    const fetchImpl = vi.fn(
      async (_input: RequestInfo | URL, _init?: RequestInit) => unpaid,
    );
    const result = await loadAndValidatePaymentTerms({
      fetchImpl,
      origin: "http://localhost",
      publicConfig,
    });
    expect(result.ok).toBe(true);
    expect(fetchImpl).toHaveBeenCalledTimes(1);
    const init = fetchImpl.mock.calls[0]?.[1];
    expect(init?.headers).toEqual({ Accept: "application/json" });
    expect(init?.redirect).toBe("error");
  });

  it("rejects redirect behavior fail-closed", async () => {
    const fetchImpl = vi.fn(async () => {
      throw new Error("redirected");
    });
    const result = await loadAndValidatePaymentTerms({
      fetchImpl,
      origin: "http://localhost",
      publicConfig,
    });
    expect(result.ok).toBe(false);
  });

  it("rejects HTTP 200 before payment", async () => {
    const fetchImpl = vi.fn(async () => new Response("{}", { status: 200 }));
    const result = await loadAndValidatePaymentTerms({
      fetchImpl,
      origin: "http://localhost",
      publicConfig,
    });
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.reason).toMatch(/402/);
    }
  });

  it("does not log private data in sanitized errors", () => {
    const message = sanitizeProviderErrorMessage(
      new Error("failed for 0x1111111111111111111111111111111111111111"),
    );
    expect(containsPrivateData(message)).toBe(false);
  });
});

describe("terms loader rejection cases", () => {
  const publicConfig = buildPayPublicConfig(
    resolveConfig({ X402_PAY_TO_ADDRESS: DEFAULT_PAY_TO }),
  );

  it.each([
    ["wrong network", { network: "eip155:8453" }],
    ["wrong token", { asset: "0x0000000000000000000000000000000000000001" }],
    ["wrong amount", { amount: "999" }],
    [
      "wrong seller",
      { payTo: "0x1111111111111111111111111111111111111111" },
    ],
  ])("rejects %s", async (_label, override) => {
    const header = encodePaymentRequired([
      {
        scheme: "exact",
        network: "eip155:84532",
        amount: BASE_SEPOLIA_PAYMENT_AMOUNT,
        asset: BASE_SEPOLIA_USDC_ASSET,
        payTo: DEFAULT_PAY_TO,
        maxTimeoutSeconds: BASE_SEPOLIA_MAX_TIMEOUT_SECONDS,
        extra: {
          name: BASE_SEPOLIA_USDC_EIP712_NAME,
          version: BASE_SEPOLIA_USDC_EIP712_VERSION,
        },
        ...override,
      },
    ]);
    const result = await loadAndValidatePaymentTerms({
      fetchImpl: vi.fn(async () => unpaidResponse(header)),
      origin: "http://localhost",
      publicConfig,
    });
    expect(result.ok).toBe(false);
  });
});

describe("facilitator startup synchronization", () => {
  it("defaults payment middleware startup sync to disabled", () => {
    const config = resolveConfig({ X402_PAY_TO_ADDRESS: DEFAULT_PAY_TO });
    const middleware = createPaymentMiddleware(config);
    expect(middleware).toBeTypeOf("function");
  });

  it("createApp defaults syncFacilitatorOnStart to false", async () => {
    const hangingFetch = vi.fn(() => new Promise(() => {}));
    vi.stubGlobal("fetch", hangingFetch);
    try {
      const app = createApp({
        useStaticFacilitator: false,
        env: { X402_PAY_TO_ADDRESS: DEFAULT_PAY_TO },
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
});

export type MockEip1193Provider = {
  request: ReturnType<typeof vi.fn>;
  on?: ReturnType<typeof vi.fn>;
};

export function createMockEip1193Provider(): MockEip1193Provider {
  return {
    request: vi.fn(async (args: { method: string }) => {
      switch (args.method) {
        case "eth_chainId":
          return "0x14a34";
        case "eth_accounts":
        case "eth_requestAccounts":
          return ["0x1111111111111111111111111111111111111111"];
        default:
          return null;
      }
    }),
    on: vi.fn(),
  };
}

describe("mock EIP-1193 provider", () => {
  it("does not invoke signing methods during ordinary reads", async () => {
    const provider = createMockEip1193Provider();
    await provider.request({ method: "eth_chainId" });
    await provider.request({ method: "eth_accounts" });
    expect(provider.request).not.toHaveBeenCalledWith(
      expect.objectContaining({ method: "personal_sign" }),
    );
  });
});
