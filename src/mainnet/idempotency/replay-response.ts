import { encodePaymentResponseHeader } from "@x402/core/http";
import {
  parseStoredSettlementReceipt,
  storedReceiptToSettleResponse,
} from "./settlement-receipt.js";

export type FulfilledReplayInput = {
  cachedResponseJson: string | null;
  cachedContentType: string | null;
  settlementReceiptJson: string | null;
};

export type FulfilledReplayResult =
  | {
      ok: true;
      body: string;
      contentType: string;
      paymentResponseHeader: string;
    }
  | { ok: false; reason: string };

export function buildFulfilledReplayResponse(
  input: FulfilledReplayInput,
): FulfilledReplayResult {
  if (!input.cachedResponseJson) {
    return { ok: false, reason: "Cached response body is missing." };
  }
  if (input.cachedContentType !== "application/json") {
    return { ok: false, reason: "Cached response content type is invalid." };
  }

  const receiptResult = parseStoredSettlementReceipt(input.settlementReceiptJson);
  if (!receiptResult.ok) {
    return { ok: false, reason: receiptResult.reason };
  }

  try {
    JSON.parse(input.cachedResponseJson);
  } catch {
    return { ok: false, reason: "Cached response body is not valid JSON." };
  }

  const settleResponse = storedReceiptToSettleResponse(receiptResult.receipt);
  const paymentResponseHeader = encodePaymentResponseHeader(settleResponse);

  return {
    ok: true,
    body: input.cachedResponseJson,
    contentType: input.cachedContentType,
    paymentResponseHeader,
  };
}

import { MAINNET_SAFE_RESPONSE_HEADERS } from "../http-security-headers.js";

export function fulfilledReplayToHttpResponse(
  replay: Extract<FulfilledReplayResult, { ok: true }>,
): Response {
  return new Response(replay.body, {
    status: 200,
    headers: {
      "Content-Type": replay.contentType,
      "PAYMENT-RESPONSE": replay.paymentResponseHeader,
      ...MAINNET_SAFE_RESPONSE_HEADERS,
    },
  });
}
