import type { PaymentQuote } from "./pay-quote.js";
import { buildConfigFingerprint, evaluatePaymentReadiness } from "./pay-quote.js";
import type { PayPublicConfig } from "../pay-public-config.js";

export type WalletState =
  | "wallet-unavailable"
  | "disconnected"
  | "connecting"
  | "wrong-network"
  | "ready"
  | "loading-terms"
  | "terms-validated"
  | "awaiting-confirmation"
  | "awaiting-wallet-signature"
  | "submitting-payment"
  | "waiting-for-settlement"
  | "success"
  | "rejected-by-user"
  | "failure"
  | "potentially-submitted"
  | "payment-disabled";

export type PendingWalletAction =
  | "connect"
  | "switch-network"
  | "load-terms"
  | "confirm-payment"
  | "sign-and-submit"
  | null;

export type PaymentSummary = {
  paying: string;
  network: string;
  service: string;
  input: string;
  sellerStatus: "verified" | "placeholder";
  tokenStatus: "verified";
  amountStatus: "verified";
  eip712Status: "verified";
  timeoutStatus: "verified";
  optionsCount: 1;
  renewal: "none";
  requestsAuthorized: 0;
};

export type WalletControllerState = {
  hasProvider: boolean;
  account: string | null;
  chainId: number | null;
  expectedChainId: number;
  publicConfig: PayPublicConfig | null;
  quote: PaymentQuote | null;
  pendingAction: PendingWalletAction;
  userRejected: boolean;
  errorMessage: string | null;
  attemptStarted: boolean;
  paymentAttemptCompleted: boolean;
  awaitingConfirmation: boolean;
  executionStage:
    | "awaiting-wallet-signature"
    | "submitting-payment"
    | "waiting-for-settlement"
    | null;
  terminalStatus: "success" | "potentially-submitted" | null;
};

export function deriveValidationStateLabel(
  state: WalletControllerState,
  walletState: WalletState,
): string {
  if (walletState === "success") {
    return "settled";
  }
  if (walletState === "potentially-submitted") {
    return "uncertain";
  }
  if (!state.quote) {
    return state.pendingAction === "load-terms" ? "loading" : "not loaded";
  }
  if (state.awaitingConfirmation) {
    return "awaiting confirmation";
  }
  return "validated";
}

export function deriveWalletState(state: WalletControllerState): WalletState {
  const config = state.publicConfig;
  if (!state.hasProvider) {
    return "wallet-unavailable";
  }
  if (config && (!config.paymentReady || config.sellerIsPlaceholder)) {
    if (state.terminalStatus === "success") {
      return "success";
    }
    if (state.terminalStatus === "potentially-submitted") {
      return "potentially-submitted";
    }
    if (state.executionStage === "awaiting-wallet-signature") {
      return "awaiting-wallet-signature";
    }
    if (state.executionStage === "submitting-payment") {
      return "submitting-payment";
    }
    if (state.executionStage === "waiting-for-settlement") {
      return "waiting-for-settlement";
    }
    return "payment-disabled";
  }

  if (state.terminalStatus === "success") {
    return "success";
  }
  if (state.terminalStatus === "potentially-submitted") {
    return "potentially-submitted";
  }
  if (state.userRejected) {
    return "rejected-by-user";
  }
  if (state.executionStage === "awaiting-wallet-signature") {
    return "awaiting-wallet-signature";
  }
  if (state.executionStage === "submitting-payment") {
    return "submitting-payment";
  }
  if (state.executionStage === "waiting-for-settlement") {
    return "waiting-for-settlement";
  }
  if (state.pendingAction === "connect") {
    return "connecting";
  }
  if (state.pendingAction === "load-terms") {
    return "loading-terms";
  }
  if (state.pendingAction === "sign-and-submit") {
    return "awaiting-wallet-signature";
  }
  if (!state.account) {
    return state.errorMessage ? "failure" : "disconnected";
  }
  if (state.chainId !== state.expectedChainId) {
    return "wrong-network";
  }
  if (state.awaitingConfirmation && state.quote) {
    return "awaiting-confirmation";
  }
  if (state.quote) {
    return "terms-validated";
  }
  if (state.errorMessage) {
    return "failure";
  }
  return "ready";
}

export function clearQuoteOnAccountChange(
  previousAccount: string | null,
  nextAccount: string | null,
  quote: PaymentQuote | null,
): PaymentQuote | null {
  if (previousAccount !== nextAccount) {
    return null;
  }
  return quote;
}

export function clearQuoteOnChainChange(
  previousChainId: number | null,
  nextChainId: number | null,
  quote: PaymentQuote | null,
): PaymentQuote | null {
  if (previousChainId !== nextChainId) {
    return null;
  }
  return quote;
}

export function clearQuoteOnConfigChange(
  quote: PaymentQuote | null,
  publicConfig: PayPublicConfig | null,
): PaymentQuote | null {
  if (!quote || !publicConfig) {
    return quote;
  }
  if (quote.configFingerprint !== buildConfigFingerprint(publicConfig)) {
    return null;
  }
  return quote;
}

export function canStartAction(
  state: WalletControllerState,
  action:
    | "connect"
    | "switch-network"
    | "load-terms"
    | "confirm-payment"
    | "sign-and-submit"
    | "reset",
): boolean {
  if (action === "reset") {
    return state.pendingAction === null && state.executionStage === null;
  }
  if (
    state.pendingAction !== null ||
    state.executionStage !== null ||
    state.terminalStatus !== null
  ) {
    return false;
  }

  switch (action) {
    case "connect":
      return state.hasProvider && state.account === null;
    case "switch-network":
      return (
        state.hasProvider &&
        state.account !== null &&
        state.chainId !== state.expectedChainId
      );
    case "load-terms":
      return (
        state.hasProvider &&
        state.account !== null &&
        state.chainId === state.expectedChainId &&
        state.quote === null &&
        !state.paymentAttemptCompleted
      );
    case "confirm-payment":
      return (
        state.quote !== null &&
        !state.awaitingConfirmation &&
        !state.paymentAttemptCompleted
      );
    case "sign-and-submit":
      return evaluatePaymentReadiness({
        publicConfig: state.publicConfig,
        account: state.account,
        chainId: state.chainId,
        expectedChainId: state.expectedChainId,
        quote: state.quote,
        pendingAction: state.pendingAction,
        attemptStarted: state.attemptStarted,
        paymentAttemptCompleted: state.paymentAttemptCompleted,
      }).ready && state.awaitingConfirmation;
  }
}

export function resetWalletControllerState(
  state: WalletControllerState,
): WalletControllerState {
  return {
    ...state,
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
}

export function invalidatePaymentSession(
  state: WalletControllerState,
): WalletControllerState {
  return {
    ...state,
    quote: null,
    awaitingConfirmation: false,
    attemptStarted: false,
    executionStage: null,
    userRejected: false,
    errorMessage: null,
  };
}

export const SIGNING_METHODS = [
  "eth_sign",
  "personal_sign",
  "eth_signTypedData",
  "eth_signTypedData_v3",
  "eth_signTypedData_v4",
  "wallet_signTypedData",
] as const;

export function isSigningMethod(method: string): boolean {
  return (SIGNING_METHODS as readonly string[]).includes(method);
}

export const ALLOWED_STATE_TRANSITIONS: Record<
  WalletState,
  readonly WalletState[]
> = {
  "wallet-unavailable": ["wallet-unavailable", "disconnected", "failure"],
  disconnected: ["connecting", "failure", "rejected-by-user"],
  connecting: ["ready", "disconnected", "wrong-network", "failure", "rejected-by-user"],
  "wrong-network": ["ready", "failure", "rejected-by-user"],
  ready: ["loading-terms", "failure", "rejected-by-user"],
  "loading-terms": [
    "terms-validated",
    "payment-disabled",
    "failure",
    "rejected-by-user",
  ],
  "terms-validated": [
    "awaiting-confirmation",
    "payment-disabled",
    "ready",
    "failure",
  ],
  "awaiting-confirmation": [
    "awaiting-wallet-signature",
    "terms-validated",
    "failure",
    "rejected-by-user",
  ],
  "awaiting-wallet-signature": [
    "submitting-payment",
    "rejected-by-user",
    "failure",
    "potentially-submitted",
  ],
  "submitting-payment": [
    "waiting-for-settlement",
    "potentially-submitted",
    "failure",
  ],
  "waiting-for-settlement": ["success", "failure", "potentially-submitted"],
  success: ["ready"],
  "rejected-by-user": ["ready", "terms-validated", "awaiting-confirmation"],
  failure: ["ready", "terms-validated", "awaiting-confirmation"],
  "potentially-submitted": ["ready"],
  "payment-disabled": [
    "payment-disabled",
    "ready",
    "terms-validated",
    "failure",
    "rejected-by-user",
  ],
};

export function isValidStateTransition(
  from: WalletState,
  to: WalletState,
): boolean {
  return ALLOWED_STATE_TRANSITIONS[from].includes(to);
}
