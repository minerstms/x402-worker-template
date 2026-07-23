import { describe, expect, it, vi, afterEach } from "vitest";
import { encodePaymentRequiredHeader } from "@x402/core/http";
import type { PaymentRequirements } from "@x402/core/types";
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
import { browserFetch } from "../src/browser/browser-fetch.js";
import { PayPageController } from "../src/browser/pay-main.js";
import { executeBoundPayment } from "../src/browser/pay-executor.js";
import {
  createPaymentQuote,
  type PaymentQuote,
} from "../src/browser/pay-quote.js";
import { loadAndValidatePaymentTerms } from "../src/browser/terms-loader.js";

const ILLEGAL_INVOCATION = "Failed to execute 'fetch' on 'Window': Illegal invocation";

function installReceiverSensitiveGlobalFetch(
  impl: (
    input: RequestInfo | URL,
    init?: RequestInit,
  ) => Response | Promise<Response>,
): void {
  const fetchImpl = function (
    this: typeof globalThis,
    input: RequestInfo | URL,
    init?: RequestInit,
  ) {
    if (this !== globalThis) {
      throw new TypeError(ILLEGAL_INVOCATION);
    }
    return impl(input, init);
  };
  vi.stubGlobal("fetch", fetchImpl as typeof fetch);
}

function createMockDocument(): Document {
  const elements = new Map<string, HTMLElement>();

  const makeElement = (id: string): HTMLElement => {
    const el = {
      id,
      textContent: "",
      innerHTML: "",
      disabled: false,
      classList: {
        add: vi.fn(),
        remove: vi.fn(),
        contains: vi.fn(() => false),
      },
      appendChild: vi.fn(),
      addEventListener: vi.fn(),
    } as unknown as HTMLElement;
    elements.set(id, el);
    return el;
  };

  for (const id of [
    "status",
    "wallet-state",
    "network-state",
    "validation-state",
    "seller-state",
    "summary-panel",
    "summary-list",
    "confirmation-panel",
    "result-panel",
    "connect-wallet",
    "switch-network",
    "load-terms",
    "review-payment",
    "sign-and-submit",
    "reset",
    "account-display",
    "seller-display",
  ]) {
    makeElement(id);
  }

  return {
    getElementById: (id: string) => elements.get(id) ?? makeElement(id),
  } as unknown as Document;
}

describe("browserFetch receiver binding", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("throws on detached global fetch, matching browser illegal invocation", () => {
    installReceiverSensitiveGlobalFetch(() => new Response("{}"));
    const detached = globalThis.fetch;

    expect(() => {
      void detached("/pay/config");
    }).toThrow(ILLEGAL_INVOCATION);
  });

  it("loads /pay/config through the browserFetch wrapper", async () => {
    const config = buildPayPublicConfig(resolveConfig());
    installReceiverSensitiveGlobalFetch((input) => {
      expect(String(input)).toBe("/pay/config");
      return Response.json(config);
    });

    const response = await browserFetch("/pay/config", {
      headers: { Accept: "application/json" },
      redirect: "error",
    });
    expect(response.ok).toBe(true);
    const body = (await response.json()) as { paymentReady: boolean };
    expect(body.paymentReady).toBe(false);
  });

  it("loads unpaid HTTP 402 terms through the browserFetch wrapper", async () => {
    const publicConfig = buildPayPublicConfig(resolveConfig());
    const requirement: PaymentRequirements = {
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
    };
    const header = encodePaymentRequiredHeader({
      x402Version: 2,
      resource: {
        url: "http://localhost/v1/example?value=browser-demo",
        mimeType: "application/json",
      },
      accepts: [requirement],
    });

    installReceiverSensitiveGlobalFetch((input, init) => {
      expect(String(input)).toContain("/v1/example?value=browser-demo");
      expect(init?.redirect).toBe("error");
      return new Response("{}", {
        status: 402,
        headers: { "payment-required": header },
      });
    });

    const result = await loadAndValidatePaymentTerms({
      fetchImpl: browserFetch,
      origin: "http://localhost",
      publicConfig,
      account: "0x1111111111111111111111111111111111111111",
      chainId: 84532,
    });
    expect(result.ok).toBe(true);
  });

  it("bootstraps PayPageController config without illegal invocation", async () => {
    const config = buildPayPublicConfig(resolveConfig());
    installReceiverSensitiveGlobalFetch((input) => {
      if (String(input) === "/pay/config") {
        return Response.json(config);
      }
      throw new Error(`Unexpected fetch: ${String(input)}`);
    });
    const root = createMockDocument();
    vi.stubGlobal("window", {
      ...globalThis,
      ethereum: undefined,
      location: { origin: "http://localhost" },
    });
    vi.stubGlobal("document", root);

    const controller = new PayPageController({ root });
    await vi.waitFor(() => {
      expect(controller.getState().publicConfig).not.toBeNull();
    });
    expect(controller.getState().errorMessage).toBeNull();
    expect(controller.getState().publicConfig?.paymentReady).toBe(false);
    expect(controller.getState().hasProvider).toBe(false);
  });

  it("executeBoundPayment accepts browserFetch without payment fetch when quote is consumed", async () => {
    installReceiverSensitiveGlobalFetch(() => {
      throw new Error("fetch should not be called");
    });

    const quote = buildQuote();
    const result = await executeBoundPayment({
      fetchImpl: browserFetch,
      client: { createPaymentPayload: vi.fn() } as never,
      httpClient: {
        encodePaymentSignatureHeader: vi.fn(),
        processPaymentResult: vi.fn(),
      } as never,
      quote: { ...quote, consumed: true },
      publicConfig: buildPayPublicConfig(resolveConfig()),
      account: quote.account,
      chainId: quote.chainId,
    });

    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.status).toBe("failure");
    expect(result.paymentBearingRequestCount).toBe(0);
    expect(result.signatureRequestCount).toBe(0);
  });
});

function buildQuote(): PaymentQuote {
  const publicConfig = buildPayPublicConfig(resolveConfig());
  const requirement: PaymentRequirements = {
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
  };
  return createPaymentQuote({
    paymentRequired: {
      x402Version: 2,
      resource: {
        url: "http://localhost/v1/example?value=browser-demo",
        mimeType: "application/json",
      },
      accepts: [requirement],
    },
    requirement,
    publicConfig,
    account: "0x1111111111111111111111111111111111111111",
    chainId: 84532,
    requestUrl: "http://localhost/v1/example?value=browser-demo",
    queryValue: "browser-demo",
  });
}
