import type { PayPublicConfig } from "../pay-public-config.js";
import { evaluatePaymentReadiness } from "./pay-quote.js";
import type { PaymentQuote } from "./pay-quote.js";
import { executeBoundPayment } from "./pay-executor.js";
import { createBrowserPaymentClients } from "./pay-signer.js";
import {
  classifyProviderError,
  sanitizeForDom,
  sanitizeProviderErrorMessage,
} from "./sanitize-error.js";
import { loadAndValidatePaymentTerms } from "./terms-loader.js";
import { browserFetch } from "./browser-fetch.js";
import {
  canStartAction,
  clearQuoteOnAccountChange,
  clearQuoteOnChainChange,
  clearQuoteOnConfigChange,
  deriveWalletState,
  invalidatePaymentSession,
  resetWalletControllerState,
  type WalletControllerState,
} from "./pay-wallet-state.js";

type Eip1193Provider = {
  request: (args: { method: string; params?: unknown[] }) => Promise<unknown>;
  on?: (event: string, listener: (...args: unknown[]) => void) => void;
  removeListener?: (event: string, listener: (...args: unknown[]) => void) => void;
};

declare global {
  interface Window {
    ethereum?: Eip1193Provider;
  }
}

const BASE_SEPOLIA_HEX = "0x14a34";

export type PayPageControllerDeps = {
  fetchImpl?: typeof fetch;
  createPaymentClients?: typeof createBrowserPaymentClients;
  executePayment?: typeof executeBoundPayment;
  root?: Document;
};

function parseChainId(value: unknown): number | null {
  if (typeof value === "string") {
    return Number.parseInt(value, value.startsWith("0x") ? 16 : 10);
  }
  if (typeof value === "number") {
    return value;
  }
  return null;
}

function getProvider(): Eip1193Provider | undefined {
  const candidate = window.ethereum;
  if (!candidate || typeof candidate.request !== "function") {
    return undefined;
  }
  return candidate;
}

export class PayPageController {
  private state: WalletControllerState;
  private provider: Eip1193Provider | undefined;
  private readonly fetchImpl: typeof fetch;
  private readonly createPaymentClients: typeof createBrowserPaymentClients;
  private readonly executePayment: typeof executeBoundPayment;
  private readonly statusEl: HTMLElement;
  private readonly walletStateEl: HTMLElement;
  private readonly networkStateEl: HTMLElement;
  private readonly validationStateEl: HTMLElement;
  private readonly sellerStateEl: HTMLElement;
  private readonly summaryPanel: HTMLElement;
  private readonly summaryList: HTMLElement;
  private readonly confirmationPanel: HTMLElement;
  private readonly resultPanel: HTMLElement;
  private readonly connectButton: HTMLButtonElement;
  private readonly switchButton: HTMLButtonElement;
  private readonly loadButton: HTMLButtonElement;
  private readonly confirmButton: HTMLButtonElement;
  private readonly payButton: HTMLButtonElement;
  private readonly resetButton: HTMLButtonElement;
  private paymentClients:
    | ReturnType<typeof createBrowserPaymentClients>
    | null = null;
  private readonly onAccountsChanged = (accounts: unknown) => {
    const nextAccount =
      Array.isArray(accounts) && typeof accounts[0] === "string"
        ? accounts[0]
        : null;
    this.state.quote = clearQuoteOnAccountChange(
      this.state.account,
      nextAccount,
      this.state.quote,
    );
    this.state.account = nextAccount;
    this.paymentClients = null;
    this.state = invalidatePaymentSession(this.state);
    this.state.userRejected = false;
    this.render();
  };
  private readonly onChainChanged = (chainId: unknown) => {
    const nextChainId = parseChainId(chainId);
    this.state.quote = clearQuoteOnChainChange(
      this.state.chainId,
      nextChainId,
      this.state.quote,
    );
    this.state.chainId = nextChainId;
    this.paymentClients = null;
    this.state = invalidatePaymentSession(this.state);
    this.render();
  };

  constructor(deps: PayPageControllerDeps = {}) {
    const root = deps.root ?? document;
    this.fetchImpl = deps.fetchImpl ?? browserFetch;
    this.createPaymentClients =
      deps.createPaymentClients ?? createBrowserPaymentClients;
    this.executePayment = deps.executePayment ?? executeBoundPayment;

    this.statusEl = root.getElementById("status")!;
    this.walletStateEl = root.getElementById("wallet-state")!;
    this.networkStateEl = root.getElementById("network-state")!;
    this.validationStateEl = root.getElementById("validation-state")!;
    this.sellerStateEl = root.getElementById("seller-state")!;
    this.summaryPanel = root.getElementById("summary-panel")!;
    this.summaryList = root.getElementById("summary-list")!;
    this.confirmationPanel = root.getElementById("confirmation-panel")!;
    this.resultPanel = root.getElementById("result-panel")!;
    this.connectButton = root.getElementById("connect-wallet") as HTMLButtonElement;
    this.switchButton = root.getElementById("switch-network") as HTMLButtonElement;
    this.loadButton = root.getElementById("load-terms") as HTMLButtonElement;
    this.confirmButton = root.getElementById("review-payment") as HTMLButtonElement;
    this.payButton = root.getElementById("sign-and-submit") as HTMLButtonElement;
    this.resetButton = root.getElementById("reset") as HTMLButtonElement;

    this.provider = getProvider();
    this.state = {
      hasProvider: Boolean(this.provider),
      account: null,
      chainId: null,
      expectedChainId: 84532,
      publicConfig: null,
      quote: null,
      pendingAction: null,
      userRejected: false,
      errorMessage: null,
      attemptStarted: false,
      paymentAttemptCompleted: false,
      awaitingConfirmation: false,
      executionStage: null,
      terminalStatus: null,
    };

    this.provider?.on?.("accountsChanged", this.onAccountsChanged);
    this.provider?.on?.("chainChanged", this.onChainChanged);

    this.connectButton.addEventListener("click", () => {
      void this.connectWallet();
    });
    this.switchButton.addEventListener("click", () => {
      void this.switchNetwork();
    });
    this.loadButton.addEventListener("click", () => {
      void this.loadTerms();
    });
    this.confirmButton.addEventListener("click", () => {
      this.reviewPayment();
    });
    this.payButton.addEventListener("click", () => {
      void this.signAndSubmit();
    });
    this.resetButton.addEventListener("click", () => {
      this.reset();
    });

    void this.bootstrap();
  }

  getState(): WalletControllerState {
    return this.state;
  }

  async bootstrap(): Promise<void> {
    try {
      const response = await this.fetchImpl("/pay/config", {
        method: "GET",
        headers: { Accept: "application/json" },
        redirect: "error",
      });
      if (!response.ok) {
        throw new Error("Could not load public payment configuration.");
      }
      const config = (await response.json()) as PayPublicConfig;
      this.state.publicConfig = config;
      this.state.expectedChainId = config.chainId;
      this.state.quote = clearQuoteOnConfigChange(this.state.quote, config);
      this.render();
    } catch (error) {
      this.state.errorMessage = sanitizeProviderErrorMessage(error);
      this.render();
    }
  }

  private async refreshProviderState(): Promise<void> {
    if (!this.provider) {
      this.state.hasProvider = false;
      return;
    }
    const accounts = (await this.provider.request({
      method: "eth_accounts",
    })) as unknown;
    this.state.account =
      Array.isArray(accounts) && typeof accounts[0] === "string"
        ? accounts[0]
        : null;
    const chainId = await this.provider.request({ method: "eth_chainId" });
    this.state.chainId = parseChainId(chainId);
  }

  async connectWallet(): Promise<void> {
    if (!canStartAction(this.state, "connect") || !this.provider) {
      return;
    }
    this.state.pendingAction = "connect";
    this.state.userRejected = false;
    this.state.errorMessage = null;
    this.render();
    try {
      const accounts = (await this.provider.request({
        method: "eth_requestAccounts",
      })) as unknown;
      this.state.account =
        Array.isArray(accounts) && typeof accounts[0] === "string"
          ? accounts[0]
          : null;
      await this.refreshProviderState();
    } catch (error) {
      const classified = classifyProviderError(error);
      this.state.errorMessage = classified.message;
      this.state.userRejected = classified.kind === "rejected";
    } finally {
      this.state.pendingAction = null;
      this.render();
    }
  }

  async switchNetwork(): Promise<void> {
    if (!canStartAction(this.state, "switch-network") || !this.provider) {
      return;
    }
    this.state.pendingAction = "switch-network";
    this.render();
    try {
      await this.provider.request({
        method: "wallet_switchEthereumChain",
        params: [{ chainId: BASE_SEPOLIA_HEX }],
      });
      await this.refreshProviderState();
    } catch (error) {
      const classified = classifyProviderError(error);
      this.state.errorMessage = classified.message;
      this.state.userRejected = classified.kind === "rejected";
    } finally {
      this.state.pendingAction = null;
      this.render();
    }
  }

  async loadTerms(): Promise<void> {
    if (
      !canStartAction(this.state, "load-terms") ||
      !this.state.publicConfig ||
      !this.state.account ||
      this.state.chainId === null
    ) {
      return;
    }
    this.state.pendingAction = "load-terms";
    this.state.errorMessage = null;
    this.render();
    try {
      const result = await loadAndValidatePaymentTerms({
        fetchImpl: this.fetchImpl,
        origin: window.location.origin,
        publicConfig: this.state.publicConfig,
        account: this.state.account,
        chainId: this.state.chainId,
      });
      if (!result.ok) {
        this.state.errorMessage = result.reason;
      } else {
        this.state.quote = result.quote;
        this.state.awaitingConfirmation = false;
      }
    } catch (error) {
      this.state.errorMessage = sanitizeProviderErrorMessage(error);
    } finally {
      this.state.pendingAction = null;
      this.render();
    }
  }

  reviewPayment(): void {
    if (!canStartAction(this.state, "confirm-payment")) {
      return;
    }
    this.state.awaitingConfirmation = true;
    this.state.errorMessage = null;
    this.render();
  }

  async signAndSubmit(): Promise<void> {
    if (
      !canStartAction(this.state, "sign-and-submit") ||
      !this.state.publicConfig ||
      !this.state.quote ||
      !this.state.account ||
      this.state.chainId === null ||
      !this.provider
    ) {
      return;
    }

    this.state.pendingAction = "sign-and-submit";
    this.state.attemptStarted = true;
    this.state.errorMessage = null;
    this.render();

    this.paymentClients =
      this.paymentClients ??
      this.createPaymentClients({
        provider: this.provider,
        account: this.state.account as `0x${string}`,
        expectedSellerAddress: this.state.publicConfig.sellerAddress,
      });

    const result = await this.executePayment({
      fetchImpl: this.fetchImpl,
      client: this.paymentClients.client,
      httpClient: this.paymentClients.httpClient,
      quote: this.state.quote,
      publicConfig: this.state.publicConfig,
      account: this.state.account,
      chainId: this.state.chainId,
      onStage: (stage) => {
        this.state.executionStage = stage;
        this.render();
      },
    });

    this.state.pendingAction = null;
    this.state.paymentAttemptCompleted = true;
    this.paymentClients = null;

    if (result.ok) {
      this.state.terminalStatus = "success";
      this.state.executionStage = null;
      this.state.errorMessage = null;
      this.renderSuccess(result.settlement, result.paidBody);
      this.render();
      return;
    }

    this.state.executionStage = null;
    this.state.errorMessage = sanitizeForDom(result.reason);
    if (result.status === "rejected-by-user") {
      this.state.userRejected = true;
    }
    if (result.status === "potentially-submitted") {
      this.state.terminalStatus = "potentially-submitted";
    }
    this.render();
  }

  reset(): void {
    if (!canStartAction(this.state, "reset")) {
      return;
    }
    this.paymentClients = null;
    this.state = resetWalletControllerState(this.state);
    this.resultPanel.textContent = "";
    this.resultPanel.classList.add("hidden");
    this.render();
  }

  private renderSuccess(settlement: { transactionRef: string | null; explorerUrl: string | null }, paidBody: unknown): void {
    this.resultPanel.classList.remove("hidden");
    this.resultPanel.textContent = "";
    const heading = document.createElement("h2");
    heading.textContent = "Payment succeeded";
    this.resultPanel.appendChild(heading);
    const summary = document.createElement("p");
    summary.textContent = "Paid API result received.";
    this.resultPanel.appendChild(summary);
    if (settlement.transactionRef) {
      const tx = document.createElement("p");
      tx.textContent = `Transaction reference: ${settlement.transactionRef}`;
      this.resultPanel.appendChild(tx);
    }
    if (settlement.explorerUrl) {
      const link = document.createElement("a");
      link.href = settlement.explorerUrl;
      link.textContent = "View on Base Sepolia explorer";
      link.rel = "noopener noreferrer";
      this.resultPanel.appendChild(link);
    }
    if (paidBody && typeof paidBody === "object") {
      const body = paidBody as { success?: boolean; input?: string };
      if (body.success === true && typeof body.input === "string") {
        const input = document.createElement("p");
        input.textContent = `Service input: ${body.input}`;
        this.resultPanel.appendChild(input);
      }
    }
  }

  render(): void {
    const walletState = deriveWalletState(this.state);
    const config = this.state.publicConfig;
    const readiness = evaluatePaymentReadiness({
      publicConfig: config,
      account: this.state.account,
      chainId: this.state.chainId,
      expectedChainId: this.state.expectedChainId,
      quote: this.state.quote,
      pendingAction: this.state.pendingAction,
      attemptStarted: this.state.attemptStarted,
      paymentAttemptCompleted: this.state.paymentAttemptCompleted,
    });

    this.walletStateEl.textContent = walletState;
    this.networkStateEl.textContent =
      this.state.chainId === null
        ? "unknown"
        : this.state.chainId === this.state.expectedChainId
          ? "Base Sepolia testnet"
          : "wrong network";
    this.validationStateEl.textContent = this.state.quote
      ? this.state.awaitingConfirmation
        ? "awaiting confirmation"
        : "validated"
      : this.state.pendingAction === "load-terms"
        ? "loading"
        : "not loaded";
    this.sellerStateEl.textContent = config
      ? config.paymentReady
        ? "verified seller configured"
        : "placeholder seller — payment disabled"
      : "unknown";

    this.connectButton.disabled = !canStartAction(this.state, "connect");
    this.switchButton.disabled = !canStartAction(this.state, "switch-network");
    this.loadButton.disabled = !canStartAction(this.state, "load-terms");
    this.confirmButton.disabled = !canStartAction(this.state, "confirm-payment");
    this.payButton.disabled = !readiness.ready;
    this.resetButton.disabled = !canStartAction(this.state, "reset");

    if (this.state.errorMessage) {
      this.statusEl.textContent = this.state.errorMessage;
    } else if (walletState === "payment-disabled") {
      this.statusEl.textContent =
        "Payment remains disabled until a real seller address is configured.";
    } else if (walletState === "potentially-submitted") {
      this.statusEl.textContent =
        "Payment submission may have started. Do not retry automatically. Load fresh terms before trying again.";
    } else if (walletState === "success") {
      this.statusEl.textContent = "Payment completed successfully.";
    } else if (walletState === "terms-validated") {
      this.statusEl.textContent =
        "Payment terms validated. Review the confirmation panel before any signing attempt.";
    } else if (walletState === "awaiting-confirmation") {
      this.statusEl.textContent =
        "Final confirmation ready. One click will request one wallet signature and one payment request.";
    } else if (walletState === "rejected-by-user") {
      this.statusEl.textContent = "Wallet request was rejected.";
    } else {
      this.statusEl.textContent = "Ready for read-only or gated payment actions.";
    }

    if (this.state.quote) {
      this.summaryPanel.classList.remove("hidden");
      this.summaryList.innerHTML = "";
      this.renderSummary(this.state.quote, config);
    } else {
      this.summaryPanel.classList.add("hidden");
      this.summaryList.innerHTML = "";
    }

    if (this.state.awaitingConfirmation && readiness.ready) {
      this.confirmationPanel.classList.remove("hidden");
    } else {
      this.confirmationPanel.classList.add("hidden");
    }

    const accountTarget = document.getElementById("account-display");
    const sellerTarget = document.getElementById("seller-display");
    if (accountTarget) {
      accountTarget.textContent = this.state.account ? "connected" : "not connected";
    }
    if (sellerTarget) {
      sellerTarget.textContent = config?.paymentReady
        ? "verified"
        : "placeholder / payment disabled";
    }
  }

  private renderSummary(quote: PaymentQuote, config: PayPublicConfig | null): void {
    const entries: Array<[string, string]> = [
      ["Paying", quote.summary.paying],
      ["Network", quote.summary.network],
      ["Service", quote.summary.service],
      ["Input", quote.summary.input],
      [
        "Seller",
        quote.summary.sellerStatus === "verified"
          ? "verified"
          : "placeholder / payment disabled",
      ],
      ["Token", quote.summary.tokenStatus],
      ["Amount", quote.summary.amountStatus],
      ["EIP-712 domain", quote.summary.eip712Status],
      ["Timeout", quote.summary.timeoutStatus],
      ["Options", "exactly one"],
      ["Renewal", quote.summary.renewal],
      ["Requests authorized", "one request only after explicit signing"],
    ];
    for (const [label, value] of entries) {
      const item = document.createElement("li");
      item.textContent = `${label}: ${value}`;
      this.summaryList.appendChild(item);
    }
    if (config && !config.paymentReady) {
      const item = document.createElement("li");
      item.textContent =
        "Seller remains a dead template placeholder. Signing and payment submission stay disabled.";
      this.summaryList.appendChild(item);
    }
  }
}

export function initPayPage(deps: PayPageControllerDeps = {}): PayPageController {
  return new PayPageController(deps);
}

if (typeof document !== "undefined") {
  document.addEventListener("DOMContentLoaded", () => {
    initPayPage();
  });
}
