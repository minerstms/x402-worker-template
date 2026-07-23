import type { x402Client } from "@x402/core/client";
import type { x402HTTPClient } from "@x402/fetch";
import {
  assertQuoteReadyForSigning,
  markQuoteConsumed,
  type PaymentQuote,
} from "./pay-quote.js";
import type { PayPublicConfig } from "../pay-public-config.js";
import {
  attachPaidResult,
  validateSettlementMetadata,
  type SafeSettlementView,
} from "./pay-settlement.js";
import {
  classifyBrowserError,
  type SafeBrowserError,
} from "./sanitize-error.js";

export type PaymentExecutionStage =
  | "awaiting-wallet-signature"
  | "submitting-payment"
  | "waiting-for-settlement";

export type PaymentExecutionResult =
  | {
      ok: true;
      status: "success";
      paidBody: unknown;
      settlement: SafeSettlementView;
      paymentBearingRequestCount: number;
      signatureRequestCount: number;
    }
  | {
      ok: false;
      status: "rejected-by-user" | "failure" | "potentially-submitted";
      reason: string;
      diagnostic: SafeBrowserError;
      paymentBearingRequestCount: number;
      signatureRequestCount: number;
      submissionStarted: boolean;
    };

export type PaymentExecutionDeps = {
  fetchImpl: typeof fetch;
  client: x402Client;
  httpClient: x402HTTPClient;
  quote: PaymentQuote;
  publicConfig: PayPublicConfig;
  account: string;
  chainId: number;
  onStage?: (stage: PaymentExecutionStage) => void;
};

export async function executeBoundPayment(
  deps: PaymentExecutionDeps,
): Promise<PaymentExecutionResult> {
  let signatureRequestCount = 0;
  let paymentBearingRequestCount = 0;
  let submissionStarted = false;

  const preflight = assertQuoteReadyForSigning({
    quote: deps.quote,
    account: deps.account,
    chainId: deps.chainId,
    publicConfig: deps.publicConfig,
  });
  if (!preflight.ok) {
    return failureResult(
      preflight.reason,
      "failure",
      signatureRequestCount,
      paymentBearingRequestCount,
      submissionStarted,
      "awaiting-wallet-signature",
    );
  }

  const consumedQuote = markQuoteConsumed(deps.quote);
  deps.onStage?.("awaiting-wallet-signature");

  let paymentPayload;
  try {
    signatureRequestCount += 1;
    paymentPayload = await deps.client.createPaymentPayload(
      consumedQuote.paymentRequired,
    );
  } catch (error) {
    const classified = classifyBrowserError(error, "awaiting-wallet-signature");
    return {
      ok: false,
      status: classified.userRejected ? "rejected-by-user" : "failure",
      reason: classified.message,
      diagnostic: classified,
      paymentBearingRequestCount,
      signatureRequestCount,
      submissionStarted,
    };
  }

  deps.onStage?.("submitting-payment");
  const paymentHeaders = deps.httpClient.encodePaymentSignatureHeader(
    paymentPayload,
  );

  let response: Response;
  try {
    submissionStarted = true;
    paymentBearingRequestCount += 1;
    response = await deps.fetchImpl(consumedQuote.requestUrl, {
      method: "GET",
      headers: {
        Accept: "application/json",
        ...paymentHeaders,
        "Access-Control-Expose-Headers":
          "PAYMENT-RESPONSE,X-PAYMENT-RESPONSE",
      },
      redirect: "error",
    });
  } catch (error) {
    const classified = classifyBrowserError(error, "submitting-payment", {
      submissionStarted: true,
    });
    return {
      ok: false,
      status: "potentially-submitted",
      reason:
        "Payment submission may have started, but the browser could not confirm the result. Do not retry automatically.",
      diagnostic: classified,
      paymentBearingRequestCount,
      signatureRequestCount,
      submissionStarted: true,
    };
  }

  deps.onStage?.("waiting-for-settlement");

  if (response.type === "opaqueredirect") {
    return failureResult(
      "Redirect responses are not allowed for payment submission.",
      "potentially-submitted",
      signatureRequestCount,
      paymentBearingRequestCount,
      true,
      "waiting-for-settlement",
    );
  }

  let paidBody: unknown = null;
  try {
    paidBody = await response.clone().json();
  } catch {
    paidBody = null;
  }

  if (response.status < 200 || response.status >= 300) {
    return failureResult(
      `Payment request returned HTTP ${response.status}.`,
      submissionStarted ? "potentially-submitted" : "failure",
      signatureRequestCount,
      paymentBearingRequestCount,
      submissionStarted,
      "waiting-for-settlement",
    );
  }

  let processResult;
  try {
    processResult = await deps.httpClient.processPaymentResult(
      paymentPayload,
      (name) => response.headers.get(name),
      response.status,
    );
  } catch (error) {
    const classified = classifyBrowserError(error, "waiting-for-settlement", {
      submissionStarted: true,
    });
    return {
      ok: false,
      status: "potentially-submitted",
      reason:
        "Payment may have been submitted, but settlement metadata could not be validated.",
      diagnostic: classified,
      paymentBearingRequestCount,
      signatureRequestCount,
      submissionStarted: true,
    };
  }

  if (processResult.recovered) {
    return failureResult(
      "Automatic payment recovery is disabled in the browser flow.",
      "potentially-submitted",
      signatureRequestCount,
      paymentBearingRequestCount,
      true,
      "waiting-for-settlement",
    );
  }

  const settlementCheck = validateSettlementMetadata({
    settlement: processResult.settleResponse,
  });
  if (!settlementCheck.ok) {
    return failureResult(
      settlementCheck.reason,
      "failure",
      signatureRequestCount,
      paymentBearingRequestCount,
      submissionStarted,
      "waiting-for-settlement",
    );
  }

  return {
    ok: true,
    status: "success",
    paidBody,
    settlement: attachPaidResult(settlementCheck.view, paidBody),
    paymentBearingRequestCount,
    signatureRequestCount,
  };
}

function failureResult(
  reason: string,
  status: "failure" | "potentially-submitted",
  signatureRequestCount: number,
  paymentBearingRequestCount: number,
  submissionStarted: boolean,
  stage: PaymentExecutionStage,
): PaymentExecutionResult {
  return {
    ok: false,
    status,
    reason,
    diagnostic: classifyBrowserError(new Error(reason), stage, {
      submissionStarted,
    }),
    paymentBearingRequestCount,
    signatureRequestCount,
    submissionStarted,
  };
}
