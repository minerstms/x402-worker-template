import type { MainnetValidatedTerms } from "./mainnet-terms-loader.js";
import type { MainnetSafeSettlementView } from "./mainnet-pay-settlement.js";
import { sanitizePaidApiBody, formatPaidApiText } from "../../browser/pay-receipt.js";

export type MainnetPaymentReceiptInput = {
  networkLabel: string;
  amountLabel: string;
  service: string;
  input: string;
  paidBody: unknown;
  settlement: MainnetSafeSettlementView;
};

export function buildMainnetReceiptInput(options: {
  terms: MainnetValidatedTerms;
  paidBody: unknown;
  settlement: MainnetSafeSettlementView;
}): MainnetPaymentReceiptInput {
  return {
    networkLabel: options.terms.summary.network,
    amountLabel: options.terms.summary.paying,
    service: options.terms.summary.service,
    input: options.terms.summary.input,
    paidBody: sanitizePaidApiBody(options.paidBody),
    settlement: options.settlement,
  };
}

export function renderMainnetPaymentReceipt(
  container: HTMLElement,
  receipt: MainnetPaymentReceiptInput,
): void {
  container.textContent = "";
  container.classList.remove("hidden");

  appendLine(container, "h2", "Simulated mainnet payment result");
  appendLine(container, "p", "Payment status: succeeded");
  appendLine(container, "p", `Network: ${receipt.networkLabel}`);
  appendLine(container, "p", `Amount: ${receipt.amountLabel}`);
  appendLine(container, "p", `Service: ${receipt.service}`);
  appendLine(container, "p", `Input: ${receipt.input}`);
  appendLine(
    container,
    "p",
    `Settlement: ${receipt.settlement.success ? "success" : "unknown"}`,
  );

  if (receipt.settlement.transactionReference) {
    appendLine(
      container,
      "p",
      `Transaction reference: ${receipt.settlement.transactionReference}`,
    );
  } else {
    appendLine(container, "p", "Transaction reference unavailable");
  }

  const paidHeading = document.createElement("p");
  paidHeading.textContent = "Paid API response:";
  container.appendChild(paidHeading);

  const paidBody = document.createElement("pre");
  paidBody.textContent = formatPaidApiText(receipt.paidBody);
  container.appendChild(paidBody);

  const followUp = document.createElement("p");
  followUp.textContent =
    "Simulated payment attempt completed. Automatic retry is disabled. Use Reset and load fresh terms before any later attempt.";
  container.appendChild(followUp);
}

function appendLine(
  container: HTMLElement,
  tag: keyof HTMLElementTagNameMap,
  text: string,
): void {
  const element = document.createElement(tag);
  element.textContent = text;
  container.appendChild(element);
}
