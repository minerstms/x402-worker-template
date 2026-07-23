export type WalletState =
  | "wallet-unavailable"
  | "disconnected"
  | "connecting"
  | "wrong-network"
  | "ready"
  | "loading-terms"
  | "terms-validated"
  | "rejected-by-user"
  | "failure";

export type PendingWalletAction =
  | "connect"
  | "switch-network"
  | "load-terms"
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
  validatedTerms: PaymentSummary | null;
  pendingAction: PendingWalletAction;
  userRejected: boolean;
  errorMessage: string | null;
};

export function deriveWalletState(state: WalletControllerState): WalletState {
  if (!state.hasProvider) {
    return "wallet-unavailable";
  }
  if (state.userRejected) {
    return "rejected-by-user";
  }
  if (state.pendingAction === "connect") {
    return "connecting";
  }
  if (state.pendingAction === "load-terms") {
    return "loading-terms";
  }
  if (!state.account) {
    return state.errorMessage ? "failure" : "disconnected";
  }
  if (state.chainId !== state.expectedChainId) {
    return "wrong-network";
  }
  if (state.validatedTerms) {
    return "terms-validated";
  }
  if (state.errorMessage) {
    return "failure";
  }
  return "ready";
}

export function clearValidatedTermsOnAccountChange(
  previousAccount: string | null,
  nextAccount: string | null,
  validatedTerms: PaymentSummary | null,
): PaymentSummary | null {
  if (previousAccount !== nextAccount) {
    return null;
  }
  return validatedTerms;
}

export function clearValidatedTermsOnChainChange(
  previousChainId: number | null,
  nextChainId: number | null,
  validatedTerms: PaymentSummary | null,
): PaymentSummary | null {
  if (previousChainId !== nextChainId) {
    return null;
  }
  return validatedTerms;
}

export function canStartAction(
  state: WalletControllerState,
  action: "connect" | "switch-network" | "load-terms" | "reset",
): boolean {
  if (action === "reset") {
    return state.pendingAction === null;
  }
  if (state.pendingAction !== null) {
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
        state.validatedTerms === null
      );
  }
}

export function resetWalletControllerState(
  state: WalletControllerState,
): WalletControllerState {
  return {
    ...state,
    validatedTerms: null,
    pendingAction: null,
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
