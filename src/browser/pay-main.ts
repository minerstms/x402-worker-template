import type { PayPublicConfig } from "../pay-public-config.js";
import { shortenAddress } from "./sanitize-error.js";
import { loadAndValidatePaymentTerms } from "./terms-loader.js";
import {
  classifyProviderError,
  sanitizeProviderErrorMessage,
} from "./sanitize-error.js";
import {
  canStartAction,
  clearValidatedTermsOnAccountChange,
  clearValidatedTermsOnChainChange,
  deriveWalletState,
  isSigningMethod,
  resetWalletControllerState,
  type PaymentSummary,
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

function installSigningGuard(provider: Eip1193Provider): void {
  const originalRequest = provider.request.bind(provider);
  provider.request = async (args) => {
    if (isSigningMethod(args.method)) {
      throw new Error("Signing is disabled in this preflight phase.");
    }
    return originalRequest(args);
  };
}

export class PayPageController {
  private state: WalletControllerState;
  private publicConfig: PayPublicConfig | null = null;
  private provider: Eip1193Provider | undefined;
  private readonly statusEl: HTMLElement;
  private readonly walletStateEl: HTMLElement;
  private readonly networkStateEl: HTMLElement;
  private readonly validationStateEl: HTMLElement;
  private readonly sellerStateEl: HTMLElement;
  private readonly summaryPanel: HTMLElement;
  private readonly summaryList: HTMLElement;
  private readonly connectButton: HTMLButtonElement;
  private readonly switchButton: HTMLButtonElement;
  private readonly loadButton: HTMLButtonElement;
  private readonly resetButton: HTMLButtonElement;
  private readonly onAccountsChanged = (accounts: unknown) => {
    const nextAccount =
      Array.isArray(accounts) && typeof accounts[0] === "string"
        ? accounts[0]
        : null;
    this.state.validatedTerms = clearValidatedTermsOnAccountChange(
      this.state.account,
      nextAccount,
      this.state.validatedTerms,
    );
    this.state.account = nextAccount;
    this.state.userRejected = false;
    this.state.errorMessage = null;
    this.render();
  };
  private readonly onChainChanged = (chainId: unknown) => {
    const nextChainId = parseChainId(chainId);
    this.state.validatedTerms = clearValidatedTermsOnChainChange(
      this.state.chainId,
      nextChainId,
      this.state.validatedTerms,
    );
    this.state.chainId = nextChainId;
    this.state.errorMessage = null;
    this.render();
  };

  constructor(root: Document = document) {
    this.statusEl = root.getElementById("status")!;
    this.walletStateEl = root.getElementById("wallet-state")!;
    this.networkStateEl = root.getElementById("network-state")!;
    this.validationStateEl = root.getElementById("validation-state")!;
    this.sellerStateEl = root.getElementById("seller-state")!;
    this.summaryPanel = root.getElementById("summary-panel")!;
    this.summaryList = root.getElementById("summary-list")!;
    this.connectButton = root.getElementById("connect-wallet") as HTMLButtonElement;
    this.switchButton = root.getElementById("switch-network") as HTMLButtonElement;
    this.loadButton = root.getElementById("load-terms") as HTMLButtonElement;
    this.resetButton = root.getElementById("reset") as HTMLButtonElement;

    this.provider = getProvider();
    this.state = {
      hasProvider: Boolean(this.provider),
      account: null,
      chainId: null,
      expectedChainId: 84532,
      validatedTerms: null,
      pendingAction: null,
      userRejected: false,
      errorMessage: null,
    };

    if (this.provider) {
      installSigningGuard(this.provider);
      this.provider.on?.("accountsChanged", this.onAccountsChanged);
      this.provider.on?.("chainChanged", this.onChainChanged);
    }

    this.connectButton.addEventListener("click", () => {
      void this.connectWallet();
    });
    this.switchButton.addEventListener("click", () => {
      void this.switchNetwork();
    });
    this.loadButton.addEventListener("click", () => {
      void this.loadTerms();
    });
    this.resetButton.addEventListener("click", () => {
      this.reset();
    });

    void this.bootstrap();
  }

  async bootstrap(): Promise<void> {
    try {
      const response = await fetch("/pay/config", {
        method: "GET",
        headers: { Accept: "application/json" },
        redirect: "error",
      });
      if (!response.ok) {
        throw new Error("Could not load public payment configuration.");
      }
      this.publicConfig = (await response.json()) as PayPublicConfig;
      this.state.expectedChainId = this.publicConfig.chainId;
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

    try {
      const accounts = (await this.provider.request({
        method: "eth_accounts",
      })) as unknown;
      this.state.account =
        Array.isArray(accounts) && typeof accounts[0] === "string"
          ? accounts[0]
          : null;
      const chainId = await this.provider.request({ method: "eth_chainId" });
      this.state.chainId = parseChainId(chainId);
      this.state.errorMessage = null;
    } catch (error) {
      const classified = classifyProviderError(error);
      this.state.errorMessage = classified.message;
      if (classified.kind === "rejected") {
        this.state.userRejected = true;
      }
    }
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
    this.state.userRejected = false;
    this.state.errorMessage = null;
    this.render();

    try {
      await this.provider.request({
        method: "wallet_switchEthereumChain",
        params: [{ chainId: BASE_SEPOLIA_HEX }],
      });
      await this.refreshProviderState();
      if (this.state.chainId !== this.state.expectedChainId) {
        this.state.errorMessage =
          "Wallet remained on the wrong network after switch request.";
      }
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
      !this.publicConfig
    ) {
      return;
    }

    this.state.pendingAction = "load-terms";
    this.state.userRejected = false;
    this.state.errorMessage = null;
    this.render();

    try {
      const result = await loadAndValidatePaymentTerms({
        fetchImpl: fetch,
        origin: window.location.origin,
        publicConfig: this.publicConfig,
      });
      if (!result.ok) {
        this.state.errorMessage = result.reason;
      } else {
        this.state.validatedTerms = result.summary;
      }
    } catch (error) {
      this.state.errorMessage = sanitizeProviderErrorMessage(error);
    } finally {
      this.state.pendingAction = null;
      this.render();
    }
  }

  reset(): void {
    if (!canStartAction(this.state, "reset")) {
      return;
    }
    this.state = resetWalletControllerState(this.state);
    this.render();
  }

  render(): void {
    const walletState = deriveWalletState(this.state);
    const config = this.publicConfig;

    this.walletStateEl.textContent = walletState;
    this.networkStateEl.textContent =
      this.state.chainId === null
        ? "unknown"
        : this.state.chainId === this.state.expectedChainId
          ? "Base Sepolia testnet"
          : "wrong network";
    this.validationStateEl.textContent = this.state.validatedTerms
      ? "validated"
      : this.state.pendingAction === "load-terms"
        ? "loading"
        : "not loaded";
    this.sellerStateEl.textContent = config
      ? config.paymentReady
        ? "verified seller configured"
        : "placeholder seller — not payment-ready"
      : "unknown";

    this.connectButton.disabled = !canStartAction(this.state, "connect");
    this.switchButton.disabled = !canStartAction(this.state, "switch-network");
    this.loadButton.disabled = !canStartAction(this.state, "load-terms");
    this.resetButton.disabled = !canStartAction(this.state, "reset");

    if (this.state.errorMessage) {
      this.statusEl.textContent = this.state.errorMessage;
    } else if (walletState === "terms-validated") {
      this.statusEl.textContent =
        "Payment terms validated. Signing and payment submission remain disabled.";
    } else if (walletState === "rejected-by-user") {
      this.statusEl.textContent = "Wallet request was rejected.";
    } else {
      this.statusEl.textContent = "Ready for read-only preflight actions.";
    }

    if (this.state.validatedTerms) {
      this.summaryPanel.classList.remove("hidden");
      this.summaryList.innerHTML = "";
      this.renderSummary(this.state.validatedTerms, config);
    } else {
      this.summaryPanel.classList.add("hidden");
      this.summaryList.innerHTML = "";
    }

    const accountLine = rootAccountLabel(this.state.account);
    const sellerLine = config
      ? config.paymentReady
        ? `verified (${shortenAddress(config.sellerAddress)})`
        : "placeholder / not payment-ready"
      : "unknown";

    const accountTarget = document.getElementById("account-display");
    const sellerTarget = document.getElementById("seller-display");
    if (accountTarget) accountTarget.textContent = accountLine;
    if (sellerTarget) sellerTarget.textContent = sellerLine;
  }

  private renderSummary(
    summary: PaymentSummary,
    config: PayPublicConfig | null,
  ): void {
    const entries: Array<[string, string]> = [
      ["Paying", summary.paying],
      ["Network", summary.network],
      ["Service", summary.service],
      ["Input", summary.input],
      [
        "Seller",
        summary.sellerStatus === "verified"
          ? "verified"
          : "placeholder / not payment-ready",
      ],
      ["Token", summary.tokenStatus],
      ["Amount", summary.amountStatus],
      ["EIP-712 domain", summary.eip712Status],
      ["Timeout", summary.timeoutStatus],
      ["Options", "exactly one"],
      ["Renewal", summary.renewal],
      ["Requests authorized", String(summary.requestsAuthorized)],
    ];

    for (const [label, value] of entries) {
      const item = document.createElement("li");
      item.textContent = `${label}: ${value}`;
      this.summaryList.appendChild(item);
    }

    if (config && !config.paymentReady) {
      const item = document.createElement("li");
      item.textContent =
        "Seller remains a dead template placeholder. No settlement can succeed yet.";
      this.summaryList.appendChild(item);
    }
  }
}

function rootAccountLabel(account: string | null): string {
  if (!account) {
    return "not connected";
  }
  return shortenAddress(account);
}

export function initPayPage(): PayPageController {
  return new PayPageController(document);
}

if (typeof document !== "undefined") {
  document.addEventListener("DOMContentLoaded", () => {
    initPayPage();
  });
}
