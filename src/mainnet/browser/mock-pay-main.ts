import {
  MainnetPayController,
} from "./mainnet-pay-controller.js";
import type { MainnetPayControllerState } from "./mainnet-pay-state.js";
import {
  buildMainnetReceiptInput,
  renderMainnetPaymentReceipt,
} from "./mainnet-pay-receipt.js";
import { submissionControlsDisabled } from "./mainnet-pay-state.js";
import { shortenPaymentIdentifier } from "./payment-id-session.js";
import { sanitizeForDom } from "../../browser/sanitize-error.js";

export type MockSimulationMode =
  | "normal-success"
  | "response-loss"
  | "verify-delayed"
  | "settle-delayed"
  | "verify-definitive-failure"
  | "settle-definitive-failure"
  | "verify-timeout"
  | "settle-timeout"
  | "malformed-settlement";

const MAINNET_TEST_SELLER = "0x000000000000000000000000000000000000dEaD";

export function createMockPayPageController(root: Document = document): MainnetPayController {
  const controller = new MainnetPayController({
    origin: window.location.origin,
    policy: { sellerAddress: MAINNET_TEST_SELLER },
    onStateChange: (state) => renderControllerState(root, state),
  });

  const loadTermsButton = root.getElementById("load-terms") as HTMLButtonElement | null;
  const submitButton = root.getElementById("sign-and-submit") as HTMLButtonElement | null;
  const resetButton = root.getElementById("reset") as HTMLButtonElement | null;
  const modeSelect = root.getElementById("simulation-mode") as HTMLSelectElement | null;

  loadTermsButton?.addEventListener("click", () => {
    void controller.loadTerms();
  });

  submitButton?.addEventListener("click", () => {
    const mode = (modeSelect?.value ?? "normal-success") as MockSimulationMode;
    void configureMockControl(mode).then(() =>
      controller.submitPayment(mode === "response-loss" ? "response-loss" : "normal"),
    );
  });

  resetButton?.addEventListener("click", () => {
    controller.reset();
  });

  controller.recoverPendingSessionOnLoad();
  renderControllerState(root, controller.snapshot);
  return controller;
}

async function configureMockControl(mode: MockSimulationMode): Promise<void> {
  await fetch("/mock-control", {
    method: "POST",
    headers: {
      Accept: "application/json",
      "Content-Type": "application/json",
    },
    body: JSON.stringify({ mode }),
    redirect: "error",
  });
}

function renderControllerState(root: Document, state: MainnetPayControllerState): void {
  setText(root, "controller-state", state.uiState);
  setText(
    root,
    "payment-id-display",
    state.paymentIdentifier
      ? shortenPaymentIdentifier(state.paymentIdentifier)
      : "not generated",
  );
  setText(root, "signing-count", String(state.signingCount));
  setText(root, "paid-request-count", String(state.paymentBearingRequestCount));
  setText(root, "status-poll-count", String(state.statusPollCount));

  const statusEl = root.getElementById("status");
  if (statusEl) {
    statusEl.textContent = sanitizeForDom(
      state.statusMessage ?? state.errorMessage ?? "Ready for simulated mainnet flow.",
    );
  }

  const loadTermsButton = root.getElementById("load-terms") as HTMLButtonElement | null;
  const submitButton = root.getElementById("sign-and-submit") as HTMLButtonElement | null;
  const resetButton = root.getElementById("reset") as HTMLButtonElement | null;
  if (loadTermsButton) {
    loadTermsButton.disabled = !controllerCanLoad(state);
  }
  if (submitButton) {
    submitButton.disabled = submissionControlsDisabled(state) || state.uiState !== "ready";
  }
  if (resetButton) {
    resetButton.disabled = state.uiState === "signing" || state.uiState === "submitting";
  }

  const resultPanel = root.getElementById("result-panel");
  if (resultPanel && state.uiState === "success" && state.terms && state.settlement) {
    renderMainnetPaymentReceipt(
      resultPanel,
      buildMainnetReceiptInput({
        terms: state.terms,
        paidBody: state.paidBody,
        settlement: state.settlement,
      }),
    );
  } else if (resultPanel) {
    resultPanel.textContent = "";
    resultPanel.classList.add("hidden");
  }
}

function controllerCanLoad(state: MainnetPayControllerState): boolean {
  return (
    !state.attemptStarted &&
    !state.attemptCompleted &&
    state.uiState !== "loading-terms" &&
    state.uiState !== "signing" &&
    state.uiState !== "submitting" &&
    state.uiState !== "polling-status"
  );
}

function setText(root: Document, id: string, value: string): void {
  const element = root.getElementById(id);
  if (element) {
    element.textContent = value;
  }
}

if (typeof document !== "undefined") {
  document.addEventListener("DOMContentLoaded", () => {
    createMockPayPageController();
  });
}
