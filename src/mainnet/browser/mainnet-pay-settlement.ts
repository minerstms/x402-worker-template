import type { SettleResponse } from "@x402/core/types";
import { MAINNET_NETWORK } from "../payment-policy.mainnet.js";

export type MainnetSafeSettlementView = {
  success: true;
  paidResult: unknown;
  transactionReference: string | null;
  networkVerified: boolean;
};

function shortenTransactionRef(value: string): string {
  if (value.length <= 14) {
    return value;
  }
  return `${value.slice(0, 8)}…${value.slice(-6)}`;
}

export function validateMainnetSettlementMetadata(options: {
  settlement: SettleResponse | undefined;
}): { ok: true; view: MainnetSafeSettlementView } | { ok: false; reason: string } {
  const { settlement } = options;
  if (!settlement || !("success" in settlement)) {
    return { ok: false, reason: "Settlement metadata is missing or invalid." };
  }
  if (!settlement.success) {
    return { ok: false, reason: "Settlement reported failure." };
  }

  const networkVerified =
    !settlement.network || settlement.network === MAINNET_NETWORK;
  if (!networkVerified) {
    return { ok: false, reason: "Settlement network is not Base mainnet." };
  }

  const transactionReference =
    typeof settlement.transaction === "string" && settlement.transaction.length > 0
      ? shortenTransactionRef(settlement.transaction)
      : null;

  return {
    ok: true,
    view: {
      success: true,
      paidResult: null,
      transactionReference,
      networkVerified,
    },
  };
}

export function attachMainnetPaidResult(
  view: MainnetSafeSettlementView,
  paidResult: unknown,
): MainnetSafeSettlementView {
  return { ...view, paidResult };
}

export function validateFulfilledStatusResult(
  result: unknown,
): { ok: true; body: unknown } | { ok: false; reason: string } {
  if (!result || typeof result !== "object" || Array.isArray(result)) {
    return { ok: false, reason: "Fulfilled status result is missing." };
  }
  const candidate = result as { contentType?: unknown; body?: unknown };
  if (candidate.contentType !== "application/json") {
    return { ok: false, reason: "Fulfilled status result content type is invalid." };
  }
  if (candidate.body === undefined) {
    return { ok: false, reason: "Fulfilled status result body is missing." };
  }
  return { ok: true, body: candidate.body };
}
