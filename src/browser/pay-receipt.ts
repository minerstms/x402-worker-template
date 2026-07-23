import type { SafeSettlementView } from "./pay-settlement.js";
import type { PaymentQuote } from "./pay-quote.js";
import { sanitizeBrowserString } from "./sanitize-error.js";

const SENSITIVE_PAID_BODY_KEYS = new Set([
  "signature",
  "typedData",
  "paymentHeader",
  "authorization",
  "payment",
  "settlement",
  "payload",
  "payTo",
  "from",
  "to",
  "paymentRequired",
  "paymentSignature",
  "accepted",
]);

export function sanitizePaidApiBody(paidBody: unknown): unknown {
  if (paidBody === null || paidBody === undefined) {
    return null;
  }
  if (typeof paidBody !== "object" || Array.isArray(paidBody)) {
    if (typeof paidBody === "string") {
      return sanitizeBrowserString(paidBody);
    }
    return paidBody;
  }

  const safe: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(paidBody as Record<string, unknown>)) {
    if (SENSITIVE_PAID_BODY_KEYS.has(key)) {
      continue;
    }
    if (key === "service" && value && typeof value === "object" && !Array.isArray(value)) {
      const service = value as Record<string, unknown>;
      safe.service = {
        id: service.id,
        name: service.name,
        retrievedAt: service.retrievedAt,
      };
      continue;
    }
    if (value && typeof value === "object" && !Array.isArray(value)) {
      safe[key] = sanitizePaidApiBody(value);
      continue;
    }
    if (typeof value === "string") {
      safe[key] = sanitizeBrowserString(value);
      continue;
    }
    safe[key] = value;
  }
  return safe;
}

export type PaymentReceiptInput = {
  networkLabel: string;
  amountLabel: string;
  service: string;
  input: string;
  paidBody: unknown;
  settlement: SafeSettlementView;
};

export function formatPaidApiText(paidBody: unknown): string {
  const sanitized = sanitizePaidApiBody(paidBody);
  if (sanitized === null || sanitized === undefined) {
    return "Unavailable";
  }
  if (typeof sanitized === "string") {
    return sanitized;
  }
  if (typeof sanitized === "number" || typeof sanitized === "boolean") {
    return String(sanitized);
  }
  try {
    return JSON.stringify(sanitized);
  } catch {
    return "Unavailable";
  }
}

export function renderPaymentReceipt(
  container: HTMLElement,
  receipt: PaymentReceiptInput,
): void {
  container.textContent = "";
  container.classList.remove("hidden");

  appendLine(container, "h2", "Payment receipt");
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

  if (receipt.settlement.transactionRef) {
    appendLine(
      container,
      "p",
      `Transaction reference: ${receipt.settlement.transactionRef}`,
    );
  } else {
    appendLine(container, "p", "Transaction reference unavailable");
  }

  if (receipt.settlement.explorerUrl) {
    const link = document.createElement("a");
    link.href = receipt.settlement.explorerUrl;
    link.textContent = "View on Base Sepolia explorer";
    link.rel = "noopener noreferrer";
    container.appendChild(link);
  }

  const paidHeading = document.createElement("p");
  paidHeading.textContent = "Paid API response:";
  container.appendChild(paidHeading);

  const paidBody = document.createElement("pre");
  paidBody.textContent = formatPaidApiText(receipt.paidBody);
  container.appendChild(paidBody);

  const followUp = document.createElement("p");
  followUp.textContent =
    "Payment attempt completed. Automatic retry is disabled. Use Reset and load fresh terms before any later attempt.";
  container.appendChild(followUp);
}

export function buildReceiptInput(options: {
  quote: PaymentQuote;
  paidBody: unknown;
  settlement: SafeSettlementView;
}): PaymentReceiptInput {
  const safePaidBody = sanitizePaidApiBody(options.paidBody);
  return {
    networkLabel: options.quote.summary.network,
    amountLabel: options.quote.summary.paying,
    service: options.quote.summary.service,
    input: options.quote.summary.input,
    paidBody: safePaidBody,
    settlement: options.settlement,
  };
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
