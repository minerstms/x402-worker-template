import { describe, expect, it, vi, beforeEach } from "vitest";
import {
  BASE_SEPOLIA_MAX_TIMEOUT_SECONDS,
  BASE_SEPOLIA_PAYMENT_AMOUNT,
  BASE_SEPOLIA_USDC_ASSET,
  BASE_SEPOLIA_USDC_EIP712_NAME,
  BASE_SEPOLIA_USDC_EIP712_VERSION,
  resolveConfig,
} from "../src/config.js";
import { buildPayPublicConfig } from "../src/pay-public-config.js";
import {
  assertQuoteReadyForSigning,
  createPaymentQuote,
  evaluatePaymentReadiness,
  type PaymentQuote,
} from "../src/browser/pay-quote.js";
import { executeBoundPayment } from "../src/browser/pay-executor.js";
import type { PayPublicConfig } from "../src/pay-public-config.js";
import {
  buildReceiptInput,
  formatPaidApiText,
  renderPaymentReceipt,
} from "../src/browser/pay-receipt.js";
import {
  canStartAction,
  deriveValidationStateLabel,
  deriveWalletState,
  type WalletControllerState,
} from "../src/browser/pay-wallet-state.js";
import {
  attachPaidResult,
  validateSettlementMetadata,
} from "../src/browser/pay-settlement.js";
import { containsPrivateData } from "../src/browser/sanitize-error.js";
import { PAY_JS } from "../src/generated/pay-assets.js";

const FAKE_ACCOUNT = "0x1111111111111111111111111111111111111111";
const FAKE_SELLER = "0x2222222222222222222222222222222222222222";

type MockElement = {
  tagName: string;
  textContent: string;
  innerHTML: string;
  href: string;
  rel: string;
  children: MockElement[];
  appendChild(child: MockElement): void;
};

let createdElements: MockElement[] = [];

function installDomMock(): void {
  createdElements = [];
  (globalThis as typeof globalThis & { document: Document }).document = {
    createElement(tag: string) {
      const element: MockElement = {
        tagName: tag.toUpperCase(),
        textContent: "",
        innerHTML: "",
        href: "",
        rel: "",
        children: [],
        appendChild(child: MockElement) {
          this.children.push(child);
        },
      };
      createdElements.push(element);
      return element as unknown as HTMLElement;
    },
  } as Document;
}

function collectText(root: MockElement): string {
  const parts = [root.textContent];
  for (const child of root.children) {
    parts.push(collectText(child));
  }
  return parts.filter(Boolean).join("\n");
}

function createMockContainer(): HTMLElement & { root: MockElement } {
  const root: MockElement = {
    tagName: "DIV",
    textContent: "",
    innerHTML: "",
    href: "",
    rel: "",
    children: [],
    appendChild(child: MockElement) {
      this.children.push(child);
    },
  };
  return {
    classList: {
      remove: vi.fn(),
      add: vi.fn(),
      contains: vi.fn(() => false),
    },
    textContent: "",
    appendChild(element: MockElement) {
      root.appendChild(element);
    },
    root,
  } as unknown as HTMLElement & { root: MockElement };
}

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

beforeEach(() => {
  installDomMock();
});

function successState(
  overrides: Partial<WalletControllerState> = {},
): WalletControllerState {
  return {
    hasProvider: true,
    account: FAKE_ACCOUNT,
    chainId: 84532,
    expectedChainId: 84532,
    publicConfig: buildPayPublicConfig(
      resolveConfig({ X402_PAY_TO_ADDRESS: FAKE_SELLER }),
    ),
    quote: buildQuote(),
    pendingAction: null,
    userRejected: false,
    errorMessage: null,
    attemptStarted: true,
    paymentAttemptCompleted: true,
    awaitingConfirmation: false,
    executionStage: null,
    terminalStatus: "success",
    ...overrides,
  };
}

function buildQuote(): PaymentQuote {
  return createPaymentQuote({
    paymentRequired: {
      x402Version: 2,
      resource: {
        url: "http://localhost/v1/example?value=browser-demo",
        mimeType: "application/json",
      },
      accepts: [
        {
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
        },
      ],
    },
    requirement: {
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
    },
    publicConfig: buildPayPublicConfig(
      resolveConfig({ X402_PAY_TO_ADDRESS: FAKE_SELLER }),
    ),
    account: FAKE_ACCOUNT,
    chainId: 84532,
    requestUrl: "http://localhost/v1/example?value=browser-demo",
    queryValue: "browser-demo",
  });
}

describe("post-success state consistency", () => {
  it("renders payment terms as settled after success", () => {
    const state = successState();
    const walletState = deriveWalletState(state);
    expect(walletState).toBe("success");
    expect(deriveValidationStateLabel(state, walletState)).toBe("settled");
  });

  it("does not render awaiting confirmation after success", () => {
    const state = successState({ awaitingConfirmation: true });
    const walletState = deriveWalletState(state);
    expect(deriveValidationStateLabel(state, walletState)).not.toBe(
      "awaiting confirmation",
    );
    expect(deriveValidationStateLabel(state, walletState)).toBe("settled");
  });

  it("cannot sign again after completed success", () => {
    const state = successState({ awaitingConfirmation: true });
    expect(canStartAction(state, "sign-and-submit")).toBe(false);
  });

  it("cannot submit again through confirm-payment after success", () => {
    const state = successState();
    expect(canStartAction(state, "confirm-payment")).toBe(false);
  });

  it("requires reset before loading fresh terms after success", () => {
    const state = successState();
    expect(canStartAction(state, "load-terms")).toBe(false);
    expect(canStartAction(state, "reset")).toBe(true);
  });

  it("keeps signing readiness false after success", () => {
    const state = successState({ awaitingConfirmation: true });
    const readiness = evaluatePaymentReadiness({
      publicConfig: state.publicConfig,
      account: state.account,
      chainId: state.chainId,
      expectedChainId: state.expectedChainId,
      quote: state.quote,
      pendingAction: state.pendingAction,
      attemptStarted: state.attemptStarted,
      paymentAttemptCompleted: state.paymentAttemptCompleted,
    });
    expect(readiness.ready).toBe(false);
  });
});

describe("payment receipt rendering", () => {
  it("renders paid API output safely as text", () => {
    const container = createMockContainer();
    const settlement = attachPaidResult(
      {
        success: true,
        paidResult: null,
        transactionRef: null,
        explorerUrl: null,
        networkVerified: true,
      },
      { success: true, input: "browser-demo" },
    );
    renderPaymentReceipt(
      container,
      buildReceiptInput({
        quote: buildQuote(),
        paidBody: { success: true, input: "browser-demo" },
        settlement,
      }),
    );
    const text = collectText(container.root);
    expect(text).toContain("browser-demo");
    expect(text).toContain("Payment receipt");
    expect(text).toContain("Automatic retry is disabled");
  });

  it("escapes HTML in paid API output", () => {
    const malicious = "<img src=x onerror=alert(1)>";
    expect(formatPaidApiText(malicious)).toBe(malicious);
    const container = createMockContainer();
    renderPaymentReceipt(
      container,
      buildReceiptInput({
        quote: buildQuote(),
        paidBody: malicious,
        settlement: {
          success: true,
          paidResult: malicious,
          transactionRef: null,
          explorerUrl: null,
          networkVerified: true,
        },
      }),
    );
    const pre = createdElements.find((node) => node.tagName === "PRE");
    expect(pre?.innerHTML).toBe("");
    expect(pre?.textContent).toBe(malicious);
    expect(createdElements.some((node) => node.tagName === "IMG")).toBe(false);
  });

  it("shortens a valid transaction hash safely", () => {
    const txHash = "0x" + "ab".repeat(32);
    const result = validateSettlementMetadata({
      settlement: { success: true, transaction: txHash, network: "eip155:84532" },
    });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.view.transactionRef).toBe(
      `${txHash.slice(0, 8)}…${txHash.slice(-6)}`,
    );
    expect(result.view.explorerUrl).toBe(
      `https://sepolia.basescan.org/tx/${txHash}`,
    );
  });

  it("does not link invalid transaction hashes", () => {
    const result = validateSettlementMetadata({
      settlement: { success: true, transaction: "not-a-hash", network: "eip155:84532" },
    });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.view.explorerUrl).toBeNull();
  });

  it("shows transaction reference unavailable when missing", () => {
    const container = createMockContainer();
    renderPaymentReceipt(
      container,
      buildReceiptInput({
        quote: buildQuote(),
        paidBody: { success: true, input: "browser-demo" },
        settlement: {
          success: true,
          paidResult: null,
          transactionRef: null,
          explorerUrl: null,
          networkVerified: true,
        },
      }),
    );
    const text = collectText(container.root);
    expect(text).toContain("Transaction reference unavailable");
  });

  it("never renders signature, typed data, or payment header fields", () => {
    const container = createMockContainer();
    renderPaymentReceipt(
      container,
      buildReceiptInput({
        quote: buildQuote(),
        paidBody: {
          success: true,
          input: "browser-demo",
          signature: "0x" + "cc".repeat(65),
          typedData: { domain: { name: "USDC" } },
          paymentHeader: "PAYMENT-SIGNATURE secret",
        },
        settlement: {
          success: true,
          paidResult: null,
          transactionRef: null,
          explorerUrl: null,
          networkVerified: true,
        },
      }),
    );
    const text = collectText(container.root);
    expect(text).not.toContain("PAYMENT-SIGNATURE");
    expect(text).not.toContain("typedData");
    expect(text).not.toMatch(/0x[a-fA-F0-9]{64,}/);
    expect(containsPrivateData(text)).toBe(false);
  });

  it("does not render complete buyer or seller addresses", () => {
    const container = createMockContainer();
    renderPaymentReceipt(
      container,
      buildReceiptInput({
        quote: buildQuote(),
        paidBody: { success: true, input: "browser-demo" },
        settlement: {
          success: true,
          paidResult: null,
          transactionRef: null,
          explorerUrl: null,
          networkVerified: true,
        },
      }),
    );
    const text = collectText(container.root);
    expect(text).not.toContain(FAKE_ACCOUNT);
    expect(text).not.toContain(FAKE_SELLER);
  });
});

describe("mainnet rejection and duplicate protections", () => {
  it("rejects mainnet payment requirements", () => {
    const quote = createPaymentQuote({
      paymentRequired: {
        x402Version: 2,
        resource: {
          url: "http://localhost/v1/example?value=browser-demo",
          mimeType: "application/json",
        },
        accepts: [
          {
            scheme: "exact",
            network: "eip155:8453",
            amount: BASE_SEPOLIA_PAYMENT_AMOUNT,
            asset: BASE_SEPOLIA_USDC_ASSET,
            payTo: FAKE_SELLER,
            maxTimeoutSeconds: BASE_SEPOLIA_MAX_TIMEOUT_SECONDS,
            extra: {
              name: BASE_SEPOLIA_USDC_EIP712_NAME,
              version: BASE_SEPOLIA_USDC_EIP712_VERSION,
            },
          },
        ],
      },
      requirement: {
        scheme: "exact",
        network: "eip155:8453",
        amount: BASE_SEPOLIA_PAYMENT_AMOUNT,
        asset: BASE_SEPOLIA_USDC_ASSET,
        payTo: FAKE_SELLER,
        maxTimeoutSeconds: BASE_SEPOLIA_MAX_TIMEOUT_SECONDS,
        extra: {
          name: BASE_SEPOLIA_USDC_EIP712_NAME,
          version: BASE_SEPOLIA_USDC_EIP712_VERSION,
        },
      },
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

  it("preserves one-signature one-request executor guards", async () => {
    const quote = { ...buildQuote(), consumed: true };
    const createPaymentPayload = vi.fn();
    const fetchImpl = vi.fn();
    const result = await executeBoundPayment({
      fetchImpl,
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
    expect(fetchImpl).not.toHaveBeenCalled();
  });
});

describe("browser bundle safety", () => {
  it("still excludes private-key buyer code", () => {
    expect(PAY_JS.includes("privateKeyToAccount")).toBe(false);
    expect(PAY_JS.includes("wrapFetchWithPayment")).toBe(false);
    expect(PAY_JS.includes("buyer-env")).toBe(false);
  });
});
