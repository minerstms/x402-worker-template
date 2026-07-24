import { generatePaymentId } from "@x402/extensions/payment-identifier";
import type { MainnetPolicyConfig } from "../payment-policy.mainnet.js";
import {
  clearPendingMainnetPaymentSession,
  readPendingMainnetPaymentSession,
  savePendingMainnetPaymentSession,
  type PendingMainnetPaymentSession,
  type SessionStorageLike,
} from "./payment-id-session.js";
import {
  loadAndValidateMainnetTerms,
  type MainnetValidatedTerms,
} from "./mainnet-terms-loader.js";
import {
  createInitialMainnetPayState,
  type MainnetPayControllerState,
  type MainnetPayUiState,
} from "./mainnet-pay-state.js";
import {
  executeMainnetPaymentAttempt,
  type MainnetSubmissionMode,
} from "./mainnet-payment-executor.js";
import {
  createFakeMainnetSigner,
  type FakeMainnetSigner,
} from "./fake-mainnet-signer.js";
import {
  attachMainnetPaidResult,
  validateFulfilledStatusResult,
  type MainnetSafeSettlementView,
} from "./mainnet-pay-settlement.js";
import {
  pollPaymentStatus,
  type StatusPollPolicy,
  type StatusPollResult,
  type TimerScheduler,
} from "./pay-status-poller.js";
import { MAINNET_PAID_ROUTE } from "../payment-policy.mainnet.js";
import { sanitizeForDom } from "../../browser/sanitize-error.js";

export type MainnetPayControllerDeps = {
  origin: string;
  policy: MainnetPolicyConfig;
  fetchImpl?: typeof fetch;
  sessionStorage?: SessionStorageLike;
  signer?: FakeMainnetSigner;
  queryValue?: string;
  pollPolicy?: StatusPollPolicy;
  scheduler?: TimerScheduler;
  onStateChange?: (state: MainnetPayControllerState) => void;
};

export class MainnetPayController {
  private state: MainnetPayControllerState;
  private readonly origin: string;
  private readonly policy: MainnetPolicyConfig;
  private readonly fetchImpl: typeof fetch;
  private readonly sessionStorage: SessionStorageLike;
  private readonly signer: FakeMainnetSigner;
  private readonly queryValue: string;
  private readonly pollPolicy?: StatusPollPolicy;
  private readonly scheduler?: TimerScheduler;
  private readonly onStateChange?: (state: MainnetPayControllerState) => void;
  private pollAbort: AbortController | null = null;
  private activePaymentIdentifier: string | null = null;

  constructor(deps: MainnetPayControllerDeps) {
    this.origin = deps.origin;
    this.policy = deps.policy;
    this.fetchImpl = deps.fetchImpl ?? fetch.bind(globalThis);
    this.sessionStorage =
      deps.sessionStorage ??
      (typeof sessionStorage !== "undefined" ? sessionStorage : createMemorySessionStorage());
    this.signer = deps.signer ?? createFakeMainnetSigner();
    this.queryValue = deps.queryValue ?? "hello";
    this.pollPolicy = deps.pollPolicy;
    this.scheduler = deps.scheduler;
    this.onStateChange = deps.onStateChange;
    this.state = createInitialMainnetPayState();
  }

  get snapshot(): MainnetPayControllerState {
    return { ...this.state };
  }

  recoverPendingSessionOnLoad(): void {
    const pending = readPendingMainnetPaymentSession(this.sessionStorage, {
      expectedRoutePath: MAINNET_PAID_ROUTE,
      expectedQueryValue: this.queryValue,
    });
    if (!pending) {
      return;
    }

    this.activePaymentIdentifier = pending.paymentIdentifier;
    this.patchState({
      paymentIdentifier: pending.paymentIdentifier,
      attemptStarted: true,
      uiState: "potentially-submitted",
      statusMessage:
        "Recovered pending simulated payment attempt. Status polling will resume without signing or resubmitting.",
    });
    void this.startStatusPolling(pending.paymentIdentifier);
  }

  async loadTerms(): Promise<void> {
    if (!this.canLoadTerms()) {
      return;
    }

    this.patchState({ uiState: "loading-terms", errorMessage: null, statusMessage: null });
    const result = await loadAndValidateMainnetTerms({
      fetchImpl: this.fetchImpl,
      origin: this.origin,
      policy: this.policy,
      queryValue: this.queryValue,
    });

    if (!result.ok) {
      this.patchState({
        uiState: "error",
        errorMessage: sanitizeForDom(result.reason),
        terms: null,
      });
      return;
    }

    this.patchState({
      uiState: "ready",
      terms: result.terms,
      errorMessage: null,
    });
  }

  async submitPayment(submissionMode: MainnetSubmissionMode = "normal"): Promise<void> {
    if (!this.canSubmit()) {
      return;
    }

    const terms = this.state.terms;
    if (!terms) {
      return;
    }

    const paymentIdentifier = this.activePaymentIdentifier ?? this.generateAndPersistPaymentIdentifier();
    this.patchState({
      attemptStarted: true,
      termsConsumed: true,
      uiState: "signing",
      paymentIdentifier,
      errorMessage: null,
      statusMessage: null,
    });

    this.patchState({ uiState: "submitting" });
    const execution = await executeMainnetPaymentAttempt({
      fetchImpl: this.fetchImpl,
      signer: this.signer,
      policy: this.policy,
      terms,
      paymentIdentifier,
      submissionMode,
    });

    this.patchState({
      signingCount: execution.signingCount,
      paymentBearingRequestCount: execution.paymentBearingRequestCount,
    });

    if (execution.ok) {
      clearPendingMainnetPaymentSession(this.sessionStorage);
      this.activePaymentIdentifier = null;
      this.patchState({
        uiState: "success",
        attemptCompleted: true,
        paidBody: execution.paidBody,
        settlement: execution.settlement,
        statusMessage: "Simulated mainnet payment succeeded.",
      });
      return;
    }

    if (execution.status === "potentially-submitted") {
      this.markPotentiallySubmitted(paymentIdentifier);
      void this.startStatusPolling(paymentIdentifier);
      return;
    }

    clearPendingMainnetPaymentSession(this.sessionStorage);
    this.activePaymentIdentifier = null;
    this.patchState({
      uiState: "failed-definitive",
      attemptCompleted: true,
      errorMessage: sanitizeForDom(execution.reason),
    });
  }

  reset(): void {
    this.cancelPolling();
    clearPendingMainnetPaymentSession(this.sessionStorage);
    this.activePaymentIdentifier = null;
    this.signer.recorder.invocationCount = 0;
    this.state = createInitialMainnetPayState();
    this.emitState();
  }

  canLoadTerms(): boolean {
    return (
      !this.state.attemptStarted &&
      !this.state.attemptCompleted &&
      this.state.uiState !== "loading-terms" &&
      this.state.uiState !== "signing" &&
      this.state.uiState !== "submitting" &&
      this.state.uiState !== "polling-status"
    );
  }

  canSubmit(): boolean {
    return (
      this.state.uiState === "ready" &&
      Boolean(this.state.terms) &&
      !this.state.termsConsumed &&
      !this.state.attemptStarted &&
      !this.state.attemptCompleted
    );
  }

  private generateAndPersistPaymentIdentifier(): string {
    const paymentIdentifier = generatePaymentId();
    this.persistPendingSession(paymentIdentifier, "submitted");
    return paymentIdentifier;
  }

  private persistPendingSession(
    paymentIdentifier: string,
    state: PendingMainnetPaymentSession["state"],
  ): void {
    savePendingMainnetPaymentSession(this.sessionStorage, {
      version: 1,
      paymentIdentifier,
      queryValue: this.queryValue,
      routePath: MAINNET_PAID_ROUTE,
      createdAt: new Date().toISOString(),
      state,
    });
  }

  private markPotentiallySubmitted(paymentIdentifier: string): void {
    this.persistPendingSession(paymentIdentifier, "potentially-submitted");
    this.patchState({
      uiState: "potentially-submitted",
      statusMessage:
        "Payment submission may have started. Status polling is active and automatic resubmission is disabled.",
    });
  }

  private async startStatusPolling(paymentIdentifier: string): Promise<void> {
    this.cancelPolling();
    this.pollAbort = new AbortController();
    this.patchState({ uiState: "polling-status" });

    const pollResult = await pollPaymentStatus({
      fetchImpl: this.fetchImpl,
      origin: this.origin,
      paymentIdentifier,
      policy: this.pollPolicy,
      scheduler: this.scheduler,
      signal: this.pollAbort.signal,
      callbacks: {
        onPoll: (pollCount) => {
          this.patchState({ statusPollCount: pollCount });
        },
        onInProgress: (state, pollCount) => {
          this.patchState({
            statusPollCount: pollCount,
            statusMessage: `Payment status: ${state}`,
          });
        },
      },
    });

    if (pollResult.kind === "cancelled") {
      return;
    }

    this.handlePollResult(pollResult, paymentIdentifier);
  }

  private handlePollResult(result: StatusPollResult, paymentIdentifier: string): void {
    if (result.kind === "fulfilled") {
      const validated = validateFulfilledStatusResult(result.body.result);
      if (!validated.ok) {
        this.patchState({
          uiState: "uncertain",
          attemptCompleted: true,
          errorMessage: sanitizeForDom(validated.reason),
          statusMessage: "Fulfilled status did not include a safe cached result.",
        });
        return;
      }

      const settlementView: MainnetSafeSettlementView = {
        success: true,
        paidResult: validated.body,
        transactionReference: result.body.transactionReference ?? null,
        networkVerified: true,
      };

      clearPendingMainnetPaymentSession(this.sessionStorage);
      this.activePaymentIdentifier = null;
      this.patchState({
        uiState: "success",
        attemptCompleted: true,
        paidBody: validated.body,
        settlement: attachMainnetPaidResult(settlementView, validated.body),
        statusPollCount: result.pollCount,
        statusMessage: "Recovered deterministic paid result from status route.",
      });
      return;
    }

    if (result.kind === "failed-definitive") {
      this.patchState({
        uiState: "failed-definitive",
        attemptCompleted: true,
        statusPollCount: result.pollCount,
        errorMessage: "Payment attempt failed definitively. Reset and load fresh terms.",
      });
      return;
    }

    if (result.kind === "expired") {
      clearPendingMainnetPaymentSession(this.sessionStorage);
      this.patchState({
        uiState: "expired",
        attemptCompleted: true,
        statusPollCount: result.pollCount,
        errorMessage: "Payment attempt expired. Reset and load fresh terms.",
      });
      return;
    }

    if (result.kind === "uncertain") {
      this.patchState({
        uiState: "uncertain",
        attemptCompleted: true,
        statusPollCount: result.pollCount,
        statusMessage: "Payment status is uncertain. Automatic retry remains disabled.",
      });
      return;
    }

    if (result.kind === "malformed") {
      this.patchState({
        uiState: "error",
        attemptCompleted: true,
        statusPollCount: result.pollCount,
        errorMessage: sanitizeForDom(result.reason),
      });
      return;
    }

    this.patchState({
      uiState: "potentially-submitted",
      statusPollCount: result.pollCount,
      statusMessage:
        "No payment attempt was found yet. Automatic resubmission remains disabled.",
    });
  }

  private cancelPolling(): void {
    this.pollAbort?.abort();
    this.pollAbort = null;
  }

  private patchState(patch: Partial<MainnetPayControllerState>): void {
    this.state = { ...this.state, ...patch };
    this.emitState();
  }

  private emitState(): void {
    this.onStateChange?.(this.snapshot);
  }
}

function createMemorySessionStorage(): SessionStorageLike {
  const map = new Map<string, string>();
  return {
    getItem(key) {
      return map.get(key) ?? null;
    },
    setItem(key, value) {
      map.set(key, value);
    },
    removeItem(key) {
      map.delete(key);
    },
  };
}

export type { MainnetValidatedTerms, MainnetPayUiState };
