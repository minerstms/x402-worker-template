import { describe, expect, it, vi } from "vitest";
import { encodePaymentRequiredHeader } from "@x402/core/http";
import type { PaymentRequired, PaymentRequirements } from "@x402/core/types";
import {
  BASE_SEPOLIA_MAX_TIMEOUT_SECONDS,
  BASE_SEPOLIA_PAYMENT_AMOUNT,
  BASE_SEPOLIA_USDC_ASSET,
  BASE_SEPOLIA_USDC_EIP712_NAME,
  BASE_SEPOLIA_USDC_EIP712_VERSION,
  DEFAULT_PAY_TO,
} from "../src/config.js";
import {
  buildPayPublicConfig,
  type PayPublicConfig,
} from "../src/pay-public-config.js";
import { resolveConfig } from "../src/config.js";
import {
  assertQuoteReadyForSigning,
  createPaymentQuote,
  evaluatePaymentReadiness,
  type PaymentQuote,
} from "../src/browser/pay-quote.js";
import { executeBoundPayment } from "../src/browser/pay-executor.js";
import {
  canStartAction,
  clearQuoteOnAccountChange,
  clearQuoteOnChainChange,
  clearQuoteOnConfigChange,
  deriveWalletState,
  resetWalletControllerState,
  type WalletControllerState,
} from "../src/browser/pay-wallet-state.js";
import {
  containsPrivateData,
  sanitizeBrowserString,
} from "../src/browser/sanitize-error.js";
import { validateSettlementMetadata } from "../src/browser/pay-settlement.js";
import { loadAndValidatePaymentTerms } from "../src/browser/terms-loader.js";
import { PAY_JS } from "../src/generated/pay-assets.js";

const FAKE_SELLER = "0x2222222222222222222222222222222222222222";
const FAKE_ACCOUNT = "0x1111111111111111111111111111111111111111";

function paymentReadyConfig(
  overrides: Partial<PayPublicConfig> = {},
): PayPublicConfig {
  return {
    ...buildPayPublicConfig(
      resolveConfig({
        X402_PAY_TO_ADDRESS: FAKE_SELLER,
      }),
    ),
    paymentReady: true,
    sellerIsPlaceholder: false,
    sellerAddress: FAKE_SELLER,
    ...overrides,
  };
}

function baseRequirement(
  overrides: Partial<PaymentRequirements> = {},
): PaymentRequirements {
  return {
    scheme: "exact",
    network: "eip155:84532",
    amount: BASE_SEPOLIA_PAYMENT_AMOUNT,
    asset: BASE_SEPOLIA_USDC_ASSET,
    payTo: FAKE_SELLER,
    maxTimeoutSeconds: BASE_SEPOLIA_MAX_TIMEOUT_SECONDS,
    extra: {
      name: BASE_SEPOLIA_USDC_EIP712_NAME,
      version: BASE_SEPOLIA_USDC_EIP712_VERSION,
    },
    ...overrides,
  };
}

function buildPaymentRequired(
  requirement: PaymentRequirements = baseRequirement(),
): PaymentRequired {
  return {
    x402Version: 2,
    resource: {
      url: "http://localhost/v1/example?value=browser-demo",
      mimeType: "application/json",
    },
    accepts: [requirement],
  };
}

function buildQuote(
  config: PayPublicConfig = paymentReadyConfig(),
  requirement: PaymentRequirements = baseRequirement(),
): PaymentQuote {
  return createPaymentQuote({
    paymentRequired: buildPaymentRequired(requirement),
    requirement,
    publicConfig: config,
    account: FAKE_ACCOUNT,
    chainId: 84532,
    requestUrl: "http://localhost/v1/example?value=browser-demo",
    queryValue: "browser-demo",
    quoteId: "quote-test-1",
  });
}

function baseControllerState(
  overrides: Partial<WalletControllerState> = {},
): WalletControllerState {
  return {
    hasProvider: true,
    account: FAKE_ACCOUNT,
    chainId: 84532,
    expectedChainId: 84532,
    publicConfig: paymentReadyConfig(),
    quote: buildQuote(),
    pendingAction: null,
    userRejected: false,
    errorMessage: null,
    attemptStarted: false,
    paymentAttemptCompleted: false,
    awaitingConfirmation: true,
    executionStage: null,
    terminalStatus: null,
    ...overrides,
  };
}

describe("payment readiness gate", () => {
  it("enters payment-disabled for placeholder config", () => {
    const state = baseControllerState({
      publicConfig: buildPayPublicConfig(resolveConfig()),
      quote: null,
      awaitingConfirmation: false,
    });
    expect(deriveWalletState(state)).toBe("payment-disabled");
  });

  it("cannot enable signing control for placeholder config", () => {
    const state = baseControllerState({
      publicConfig: buildPayPublicConfig(resolveConfig()),
      awaitingConfirmation: true,
    });
    expect(canStartAction(state, "sign-and-submit")).toBe(false);
  });
});

describe("quote binding and stale prevention", () => {
  it("clears quote on account change", () => {
    expect(
      clearQuoteOnAccountChange(FAKE_ACCOUNT, FAKE_SELLER, buildQuote()),
    ).toBeNull();
  });

  it("clears quote on chain change", () => {
    expect(clearQuoteOnChainChange(84532, 1, buildQuote())).toBeNull();
  });

  it("clears quote on config change", () => {
    const quote = buildQuote();
    expect(
      clearQuoteOnConfigChange(
        quote,
        paymentReadyConfig({ sellerAddress: DEFAULT_PAY_TO }),
      ),
    ).toBeNull();
  });

  it("reset clears payment state", () => {
    const reset = resetWalletControllerState(
      baseControllerState({ attemptStarted: true }),
    );
    expect(reset.quote).toBeNull();
    expect(reset.awaitingConfirmation).toBe(false);
  });

  it("rejects stale seller", () => {
    const quote = buildQuote();
    const result = assertQuoteReadyForSigning({
      quote,
      account: FAKE_ACCOUNT,
      chainId: 84532,
      publicConfig: paymentReadyConfig({ sellerAddress: DEFAULT_PAY_TO }),
    });
    expect(result.ok).toBe(false);
  });

  it.each([
    ["amount", { amount: "999" }],
    ["token", { asset: "0x0000000000000000000000000000000000000001" }],
    ["timeout", { maxTimeoutSeconds: 299 }],
    ["eip712 name", { extra: { name: "BAD", version: "2" } }],
    ["eip712 version", { extra: { name: "USDC", version: "1" } }],
    ["mainnet", { network: "eip155:8453" as `${string}:${string}` }],
  ])("rejects changed %s", (_label, override) => {
    const quote = buildQuote(paymentReadyConfig(), baseRequirement(override));
    const result = assertQuoteReadyForSigning({
      quote,
      account: FAKE_ACCOUNT,
      chainId: 84532,
      publicConfig: paymentReadyConfig(),
    });
    expect(result.ok).toBe(false);
  });

  it("rejects duplicate payment options", () => {
    const requirement = baseRequirement();
    const quote = createPaymentQuote({
      paymentRequired: {
        ...buildPaymentRequired(requirement),
        accepts: [requirement, { ...requirement }],
      },
      requirement,
      publicConfig: paymentReadyConfig(),
      account: FAKE_ACCOUNT,
      chainId: 84532,
      requestUrl: "http://localhost/v1/example?value=browser-demo",
      queryValue: "browser-demo",
    });
    const result = assertQuoteReadyForSigning({
      quote,
      account: FAKE_ACCOUNT,
      chainId: 84532,
      publicConfig: paymentReadyConfig(),
    });
    expect(result.ok).toBe(false);
  });

  it("rejects wrong chain", () => {
    const result = assertQuoteReadyForSigning({
      quote: buildQuote(),
      account: FAKE_ACCOUNT,
      chainId: 1,
      publicConfig: paymentReadyConfig(),
    });
    expect(result.ok).toBe(false);
  });
});

describe("executeBoundPayment mocked flow", () => {
  it("uses exact validated URL with redirect error and no retry", async () => {
    const quote = buildQuote();
    const fetchImpl = vi.fn(async () =>
      Response.json(
        { success: true, input: "browser-demo" },
        {
          status: 200,
          headers: {
            "payment-response": Buffer.from(
              JSON.stringify({
                success: true,
                transaction: "0x" + "aa".repeat(32),
                network: "eip155:84532",
              }),
              "utf8",
            ).toString("base64"),
          },
        },
      ),
    );
    const createPaymentPayload = vi.fn(async () => ({
      x402Version: 2,
      payload: {},
      accepted: quote.requirement,
    }));
    const encodePaymentSignatureHeader = vi.fn(() => ({
      "PAYMENT-SIGNATURE": "encoded",
    }));
    const processPaymentResult = vi.fn(async () => ({
      recovered: false,
      settleResponse: {
        success: true,
        transaction: "0x" + "aa".repeat(32),
        network: "eip155:84532",
      },
    }));

    const result = await executeBoundPayment({
      fetchImpl,
      client: { createPaymentPayload } as never,
      httpClient: {
        encodePaymentSignatureHeader,
        processPaymentResult,
      } as never,
      quote,
      publicConfig: paymentReadyConfig(),
      account: FAKE_ACCOUNT,
      chainId: 84532,
    });

    expect(result.ok).toBe(true);
    expect(createPaymentPayload).toHaveBeenCalledTimes(1);
    expect(fetchImpl).toHaveBeenCalledTimes(1);
    expect(fetchImpl).toHaveBeenCalledWith(
      quote.requestUrl,
      expect.objectContaining({ redirect: "error" }),
    );
    expect(processPaymentResult).toHaveBeenCalledTimes(1);
  });

  it("returns rejected-by-user with zero payment-bearing requests", async () => {
    const quote = buildQuote();
    const fetchImpl = vi.fn();
    const result = await executeBoundPayment({
      fetchImpl,
      client: {
        createPaymentPayload: vi.fn(async () => {
          throw { code: 4001, message: "User rejected the request." };
        }),
      } as never,
      httpClient: {
        encodePaymentSignatureHeader: vi.fn(),
        processPaymentResult: vi.fn(),
      } as never,
      quote,
      publicConfig: paymentReadyConfig(),
      account: FAKE_ACCOUNT,
      chainId: 84532,
    });
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.status).toBe("rejected-by-user");
    expect(result.paymentBearingRequestCount).toBe(0);
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  it("stays failure when signature fails before submission begins", async () => {
    const quote = buildQuote();
    const fetchImpl = vi.fn();
    const result = await executeBoundPayment({
      fetchImpl,
      client: {
        createPaymentPayload: vi.fn(async () => {
          throw new Error("provider unavailable");
        }),
      } as never,
      httpClient: {
        encodePaymentSignatureHeader: vi.fn(),
        processPaymentResult: vi.fn(),
      } as never,
      quote,
      publicConfig: paymentReadyConfig(),
      account: FAKE_ACCOUNT,
      chainId: 84532,
    });
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.status).toBe("failure");
    expect(result.paymentBearingRequestCount).toBe(0);
    expect(result.signatureRequestCount).toBe(1);
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  it("reaches success with valid settlement metadata", async () => {
    const quote = buildQuote();
    const txHash = "0x" + "cc".repeat(32);
    const result = await executeBoundPayment({
      fetchImpl: vi.fn(async () =>
        Response.json(
          { success: true, input: "browser-demo" },
          {
            status: 200,
            headers: {
              "payment-response": Buffer.from(
                JSON.stringify({
                  success: true,
                  transaction: txHash,
                  network: "eip155:84532",
                }),
                "utf8",
              ).toString("base64"),
            },
          },
        ),
      ),
      client: {
        createPaymentPayload: vi.fn(async () => ({
          x402Version: 2,
          payload: {},
          accepted: quote.requirement,
        })),
      } as never,
      httpClient: {
        encodePaymentSignatureHeader: vi.fn(() => ({
          "PAYMENT-SIGNATURE": "encoded",
        })),
        processPaymentResult: vi.fn(async () => ({
          recovered: false,
          settleResponse: {
            success: true,
            transaction: txHash,
            network: "eip155:84532",
          },
        })),
      } as never,
      quote,
      publicConfig: paymentReadyConfig(),
      account: FAKE_ACCOUNT,
      chainId: 84532,
    });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.status).toBe("success");
    expect(result.signatureRequestCount).toBe(1);
    expect(result.paymentBearingRequestCount).toBe(1);
  });

  it("enters potentially-submitted when fetch fails after submission begins", async () => {
    const quote = buildQuote();
    const result = await executeBoundPayment({
      fetchImpl: vi.fn(async () => {
        throw new Error("network interrupted");
      }),
      client: {
        createPaymentPayload: vi.fn(async () => ({
          x402Version: 2,
          payload: {},
          accepted: quote.requirement,
        })),
      } as never,
      httpClient: {
        encodePaymentSignatureHeader: vi.fn(() => ({
          "PAYMENT-SIGNATURE": "encoded",
        })),
        processPaymentResult: vi.fn(),
      } as never,
      quote,
      publicConfig: paymentReadyConfig(),
      account: FAKE_ACCOUNT,
      chainId: 84532,
    });
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.status).toBe("potentially-submitted");
    expect(result.paymentBearingRequestCount).toBe(1);
  });

  it("fails closed on HTTP redirect response type", async () => {
    const quote = buildQuote();
    const result = await executeBoundPayment({
      fetchImpl: vi.fn(async () => ({ type: "opaqueredirect" }) as Response),
      client: {
        createPaymentPayload: vi.fn(async () => ({
          x402Version: 2,
          payload: {},
          accepted: quote.requirement,
        })),
      } as never,
      httpClient: {
        encodePaymentSignatureHeader: vi.fn(() => ({
          "PAYMENT-SIGNATURE": "encoded",
        })),
        processPaymentResult: vi.fn(),
      } as never,
      quote,
      publicConfig: paymentReadyConfig(),
      account: FAKE_ACCOUNT,
      chainId: 84532,
    });
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.status).toBe("potentially-submitted");
  });

  it("allows only one signature for repeated execution attempts on consumed quote", async () => {
    const quote = { ...buildQuote(), consumed: true };
    const createPaymentPayload = vi.fn();
    const result = await executeBoundPayment({
      fetchImpl: vi.fn(),
      client: { createPaymentPayload } as never,
      httpClient: {
        encodePaymentSignatureHeader: vi.fn(),
        processPaymentResult: vi.fn(),
      } as never,
      quote,
      publicConfig: paymentReadyConfig(),
      account: FAKE_ACCOUNT,
      chainId: 84532,
    });
    expect(result.ok).toBe(false);
    expect(createPaymentPayload).not.toHaveBeenCalled();
  });

  it("does not auto-retry when SDK reports recovered", async () => {
    const quote = buildQuote();
    const fetchImpl = vi.fn(async () =>
      Response.json({ success: true }, { status: 200 }),
    );
    const result = await executeBoundPayment({
      fetchImpl,
      client: {
        createPaymentPayload: vi.fn(async () => ({
          x402Version: 2,
          payload: {},
          accepted: quote.requirement,
        })),
      } as never,
      httpClient: {
        encodePaymentSignatureHeader: vi.fn(() => ({
          "PAYMENT-SIGNATURE": "encoded",
        })),
        processPaymentResult: vi.fn(async () => ({ recovered: true })),
      } as never,
      quote,
      publicConfig: paymentReadyConfig(),
      account: FAKE_ACCOUNT,
      chainId: 84532,
    });
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.status).toBe("potentially-submitted");
    expect(fetchImpl).toHaveBeenCalledTimes(1);
  });
});

describe("settlement and sanitization", () => {
  it("validates settlement metadata for success", () => {
    const result = validateSettlementMetadata({
      settlement: {
        success: true,
        transaction: "0x" + "bb".repeat(32),
        network: "eip155:84532",
      },
    });
    expect(result.ok).toBe(true);
  });

  it("fails closed on invalid settlement metadata", () => {
    const result = validateSettlementMetadata({
      settlement: {
        success: true,
        transaction: "",
        network: "eip155:8453",
      },
    });
    expect(result.ok).toBe(false);
  });

  it("does not expose private data in sanitized strings", () => {
    const sanitized = sanitizeBrowserString(
      "failed for 0x1111111111111111111111111111111111111111 with payment-signature abc",
    );
    expect(containsPrivateData(sanitized)).toBe(false);
  });

  it("redacts typed data, signatures, and payment headers", () => {
    const sanitized = sanitizeBrowserString(
      JSON.stringify({
        typedData: { domain: { name: "USDC" } },
        signature: "0x" + "dd".repeat(65),
        authorization: "secret-auth",
        paymentHeader: "PAYMENT-SIGNATURE value",
      }),
    );
    expect(sanitized).toContain("[redacted]");
    expect(sanitized).not.toMatch(/0x[a-fA-F0-9]{64,}/);
    expect(containsPrivateData(sanitized)).toBe(false);
  });
});

describe("PayPageController mocked integration", () => {
  it("does not enable signing for placeholder config", () => {
    const state = baseControllerState({
      publicConfig: buildPayPublicConfig(resolveConfig()),
      awaitingConfirmation: true,
    });
    expect(canStartAction(state, "sign-and-submit")).toBe(false);
  });

  it("prevents double payment action while busy", () => {
    const state = baseControllerState({ pendingAction: "sign-and-submit" });
    expect(canStartAction(state, "sign-and-submit")).toBe(false);
  });

  it("requires fresh terms after a completed payment attempt", () => {
    const state = baseControllerState({
      paymentAttemptCompleted: true,
      awaitingConfirmation: true,
    });
    expect(canStartAction(state, "sign-and-submit")).toBe(false);
  });
});

describe("terms loader", () => {
  it("loads and validates exact 402 terms into a bound quote", async () => {
    const paymentRequired = buildPaymentRequired(
      baseRequirement({ payTo: DEFAULT_PAY_TO }),
    );
    const header = encodePaymentRequiredHeader(paymentRequired);
    const fetchImpl = vi.fn(async () =>
      new Response("{}", {
        status: 402,
        headers: { "payment-required": header },
      }),
    );
    const result = await loadAndValidatePaymentTerms({
      fetchImpl,
      origin: "http://localhost",
      publicConfig: buildPayPublicConfig(resolveConfig()),
      account: FAKE_ACCOUNT,
      chainId: 84532,
    });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.quote.requestUrl).toBe(
      "http://localhost/v1/example?value=browser-demo",
    );
  });
});

describe("browser bundle safety", () => {
  it("does not include private-key buyer code", () => {
    expect(PAY_JS.includes("privateKeyToAccount")).toBe(false);
    expect(PAY_JS.includes("wrapFetchWithPayment")).toBe(false);
    expect(PAY_JS.includes("buyer-env")).toBe(false);
  });
});

describe("payment-ready confirmation gating", () => {
  it("enables final confirmation only after valid terms", () => {
    const ready = evaluatePaymentReadiness({
      publicConfig: paymentReadyConfig(),
      account: FAKE_ACCOUNT,
      chainId: 84532,
      expectedChainId: 84532,
      quote: buildQuote(),
      pendingAction: null,
      attemptStarted: false,
      paymentAttemptCompleted: false,
    });
    expect(ready.ready).toBe(true);
    const state = baseControllerState({ awaitingConfirmation: false });
    expect(canStartAction(state, "confirm-payment")).toBe(true);
  });
});

describe("testnet labeling", () => {
  it("keeps Base Sepolia testnet labeling in payment-ready config", () => {
    expect(paymentReadyConfig().environmentLabel).toBe("BASE SEPOLIA TESTNET");
  });
});
