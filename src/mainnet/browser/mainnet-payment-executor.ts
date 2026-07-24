import { x402Client } from "@x402/core/client";
import { encodePaymentSignatureHeader } from "@x402/core/http";
import { x402HTTPClient } from "@x402/fetch";
import { ExactEvmScheme } from "@x402/evm/exact/client";
import {
  appendPaymentIdentifierToExtensions,
  generatePaymentId,
  PAYMENT_IDENTIFIER,
} from "@x402/extensions/payment-identifier";
import type { PaymentPayload, PaymentRequired } from "@x402/core/types";
import {
  createMainnetPaymentPolicy,
  MAINNET_NETWORK,
  selectMainnetPaymentRequirement,
  type MainnetPolicyConfig,
} from "../payment-policy.mainnet.js";
import type { MainnetValidatedTerms } from "./mainnet-terms-loader.js";
import type { FakeMainnetSigner } from "./fake-mainnet-signer.js";
import {
  attachMainnetPaidResult,
  validateMainnetSettlementMetadata,
  type MainnetSafeSettlementView,
} from "./mainnet-pay-settlement.js";
import { classifyBrowserError } from "../../browser/sanitize-error.js";

export type MainnetSubmissionMode = "normal" | "response-loss";

export type MainnetPaymentExecutionResult =
  | {
      ok: true;
      status: "success";
      paymentIdentifier: string;
      paidBody: unknown;
      settlement: MainnetSafeSettlementView;
      signingCount: 1;
      paymentBearingRequestCount: 1;
    }
  | {
      ok: false;
      status: "failure" | "potentially-submitted";
      reason: string;
      paymentIdentifier: string;
      signingCount: number;
      paymentBearingRequestCount: number;
      submissionStarted: boolean;
    };

export type MainnetPaymentExecutorDeps = {
  fetchImpl: typeof fetch;
  signer: FakeMainnetSigner;
  policy: MainnetPolicyConfig;
  terms: MainnetValidatedTerms;
  paymentIdentifier?: string;
  submissionMode?: MainnetSubmissionMode;
};

export type MainnetPaymentExecutorSnapshot = {
  paymentIdentifier: string | null;
  encodedPaymentHeader: string | null;
  paymentPayload: PaymentPayload | null;
  signature: string | null;
};

export async function executeMainnetPaymentAttempt(
  deps: MainnetPaymentExecutorDeps,
): Promise<MainnetPaymentExecutionResult> {
  const paymentIdentifier = deps.paymentIdentifier ?? generatePaymentId();
  const paymentRequiredWithId = appendPaymentIdentifierToPaymentRequired(
    deps.terms.paymentRequired,
    paymentIdentifier,
  );

  const client = new x402Client(selectMainnetPaymentRequirement);
  client.register(MAINNET_NETWORK, new ExactEvmScheme(deps.signer));
  client.registerPolicy(createMainnetPaymentPolicy(deps.policy.sellerAddress));
  const httpClient = new x402HTTPClient(client);

  let paymentPayload: PaymentPayload;
  try {
    paymentPayload = await client.createPaymentPayload(paymentRequiredWithId);
  } catch (error) {
    return {
      ok: false,
      status: "failure",
      reason: classifyBrowserError(error, "signing").message,
      paymentIdentifier,
      signingCount: deps.signer.recorder.invocationCount,
      paymentBearingRequestCount: 0,
      submissionStarted: false,
    };
  }

  const encodedHeader = encodePaymentSignatureHeader(paymentPayload);
  const signature = readPayloadSignature(paymentPayload);

  const paymentHeaders = httpClient.encodePaymentSignatureHeader(paymentPayload);

  let response: Response;
  try {
    response = await submitPaidRequest({
      fetchImpl: deps.fetchImpl,
      requestUrl: deps.terms.requestUrl,
      paymentHeaders,
      submissionMode: deps.submissionMode ?? "normal",
    });
  } catch {
    clearSensitivePayloadFields(paymentPayload);
    return {
      ok: false,
      status: "potentially-submitted",
      reason:
        "Payment submission may have started, but the browser could not confirm the result. Do not retry automatically.",
      paymentIdentifier,
      signingCount: deps.signer.recorder.invocationCount,
      paymentBearingRequestCount: 1,
      submissionStarted: true,
    };
  }

  if (response.status < 200 || response.status >= 300) {
    clearSensitivePayloadFields(paymentPayload);
    return {
      ok: false,
      status: "potentially-submitted",
      reason: `Payment request returned HTTP ${response.status}.`,
      paymentIdentifier,
      signingCount: deps.signer.recorder.invocationCount,
      paymentBearingRequestCount: 1,
      submissionStarted: true,
    };
  }

  let paidBody: unknown = null;
  try {
    paidBody = await response.clone().json();
  } catch {
    paidBody = null;
  }

  let processResult;
  try {
    processResult = await httpClient.processPaymentResult(
      paymentPayload,
      (name) => response.headers.get(name),
      response.status,
    );
  } catch {
    return {
      ok: false,
      status: "potentially-submitted",
      reason:
        "Payment may have been submitted, but settlement metadata could not be validated.",
      paymentIdentifier,
      signingCount: deps.signer.recorder.invocationCount,
      paymentBearingRequestCount: 1,
      submissionStarted: true,
    };
  }

  const settlementCheck = validateMainnetSettlementMetadata({
    settlement: processResult.settleResponse,
  });
  if (!settlementCheck.ok) {
    clearSensitivePayloadFields(paymentPayload);
    return {
      ok: false,
      status: "failure",
      reason: settlementCheck.reason,
      paymentIdentifier,
      signingCount: deps.signer.recorder.invocationCount,
      paymentBearingRequestCount: 1,
      submissionStarted: true,
    };
  }

  clearSensitivePayloadFields(paymentPayload);
  void encodedHeader;
  void signature;

  return {
    ok: true,
    status: "success",
    paymentIdentifier,
    paidBody,
    settlement: attachMainnetPaidResult(settlementCheck.view, paidBody),
    signingCount: 1,
    paymentBearingRequestCount: 1,
  };
}

function appendPaymentIdentifierToPaymentRequired(
  paymentRequired: PaymentRequired,
  paymentIdentifier: string,
): PaymentRequired {
  const extensions = {
    ...(paymentRequired.extensions ?? {}),
  };
  appendPaymentIdentifierToExtensions(extensions, paymentIdentifier);
  return {
    ...paymentRequired,
    extensions,
  };
}

async function submitPaidRequest(options: {
  fetchImpl: typeof fetch;
  requestUrl: string;
  paymentHeaders: Record<string, string>;
  submissionMode: MainnetSubmissionMode;
}): Promise<Response> {
  const response = await options.fetchImpl(options.requestUrl, {
    method: "GET",
    headers: {
      Accept: "application/json",
      ...options.paymentHeaders,
      "Access-Control-Expose-Headers": "PAYMENT-RESPONSE,X-PAYMENT-RESPONSE",
    },
    redirect: "error",
  });

  if (options.submissionMode === "response-loss") {
    throw new Error("simulated response loss");
  }

  return response;
}

function readPayloadSignature(payload: PaymentPayload): string | null {
  const inner = payload.payload;
  if (!inner || typeof inner !== "object" || Array.isArray(inner)) {
    return null;
  }
  const signature = (inner as { signature?: unknown }).signature;
  return typeof signature === "string" ? signature : null;
}

function clearSensitivePayloadFields(payload: PaymentPayload): void {
  if (payload.extensions?.[PAYMENT_IDENTIFIER]) {
    const extension = payload.extensions[PAYMENT_IDENTIFIER] as {
      info?: { id?: string };
    };
    if (extension.info) {
      delete extension.info.id;
    }
  }
  const inner = payload.payload;
  if (inner && typeof inner === "object" && !Array.isArray(inner)) {
    delete (inner as { signature?: string }).signature;
  }
}

export function readExecutorSensitiveSnapshot(
  payload: PaymentPayload | null,
  encodedHeader: string | null,
): MainnetPaymentExecutorSnapshot {
  return {
    paymentIdentifier: payload
      ? ((payload.extensions?.[PAYMENT_IDENTIFIER] as { info?: { id?: string } })
          ?.info?.id ?? null)
      : null,
    encodedPaymentHeader: encodedHeader,
    paymentPayload: payload,
    signature:
      payload && payload.payload && typeof payload.payload === "object"
        ? ((payload.payload as { signature?: string }).signature ?? null)
        : null,
  };
}
