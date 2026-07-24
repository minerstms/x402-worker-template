import type { MainnetValidatedTerms } from "./mainnet-terms-loader.js";
import type { MainnetSafeSettlementView } from "./mainnet-pay-settlement.js";

export type MainnetPayUiState =
  | "idle"
  | "loading-terms"
  | "ready"
  | "signing"
  | "submitting"
  | "potentially-submitted"
  | "polling-status"
  | "success"
  | "failed-definitive"
  | "uncertain"
  | "expired"
  | "error";

export type MainnetPayControllerState = {
  uiState: MainnetPayUiState;
  terms: MainnetValidatedTerms | null;
  paymentIdentifier: string | null;
  termsConsumed: boolean;
  attemptStarted: boolean;
  attemptCompleted: boolean;
  errorMessage: string | null;
  paidBody: unknown;
  settlement: MainnetSafeSettlementView | null;
  signingCount: number;
  paymentBearingRequestCount: number;
  statusPollCount: number;
  statusMessage: string | null;
};

export function createInitialMainnetPayState(): MainnetPayControllerState {
  return {
    uiState: "idle",
    terms: null,
    paymentIdentifier: null,
    termsConsumed: false,
    attemptStarted: false,
    attemptCompleted: false,
    errorMessage: null,
    paidBody: null,
    settlement: null,
    signingCount: 0,
    paymentBearingRequestCount: 0,
    statusPollCount: 0,
    statusMessage: null,
  };
}

export function canLoadMainnetTerms(state: MainnetPayControllerState): boolean {
  return (
    !state.attemptStarted &&
    !state.attemptCompleted &&
    state.uiState !== "loading-terms" &&
    state.uiState !== "signing" &&
    state.uiState !== "submitting" &&
    state.uiState !== "polling-status"
  );
}

export function canSubmitMainnetPayment(state: MainnetPayControllerState): boolean {
  return (
    state.uiState === "ready" &&
    Boolean(state.terms) &&
    !state.termsConsumed &&
    !state.attemptStarted &&
    !state.attemptCompleted
  );
}

export function canResetMainnetPayment(state: MainnetPayControllerState): boolean {
  return state.uiState !== "signing" && state.uiState !== "submitting";
}

export function submissionControlsDisabled(state: MainnetPayControllerState): boolean {
  return (
    state.attemptStarted ||
    state.attemptCompleted ||
    state.uiState === "loading-terms" ||
    state.uiState === "signing" ||
    state.uiState === "submitting" ||
    state.uiState === "polling-status" ||
    state.uiState === "success"
  );
}
