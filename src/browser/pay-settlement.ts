import type { SettleResponse } from "@x402/core/types";
import { ALLOWED_SELLER_NETWORK } from "../config.js";
import { shortenAddress } from "./sanitize-error.js";

export const BASE_SEPOLIA_EXPLORER_ORIGIN = "https://sepolia.basescan.org";

export type SafeSettlementView = {
  success: true;
  paidResult: unknown;
  transactionRef: string | null;
  explorerUrl: string | null;
  networkVerified: boolean;
};

export function validateSettlementMetadata(options: {
  settlement: SettleResponse | undefined;
}): { ok: true; view: SafeSettlementView } | { ok: false; reason: string } {
  const { settlement } = options;
  if (!settlement || !("success" in settlement)) {
    return { ok: false, reason: "Settlement metadata is missing or invalid." };
  }
  if (!settlement.success) {
    return { ok: false, reason: "Settlement reported failure." };
  }

  const networkVerified =
    !settlement.network || settlement.network === ALLOWED_SELLER_NETWORK;
  if (!networkVerified) {
    return { ok: false, reason: "Settlement network is not Base Sepolia." };
  }

  const transactionRef =
    typeof settlement.transaction === "string" && settlement.transaction.length > 0
      ? shortenTransactionRef(settlement.transaction)
      : null;
  const explorerUrl =
    typeof settlement.transaction === "string" &&
    /^0x[0-9a-fA-F]{64}$/.test(settlement.transaction)
      ? `${BASE_SEPOLIA_EXPLORER_ORIGIN}/tx/${settlement.transaction}`
      : null;

  return {
    ok: true,
    view: {
      success: true,
      paidResult: null,
      transactionRef,
      explorerUrl,
      networkVerified,
    },
  };
}

export function attachPaidResult(
  view: SafeSettlementView,
  paidResult: unknown,
): SafeSettlementView {
  return { ...view, paidResult };
}

function shortenTransactionRef(value: string): string {
  if (value.length <= 14) {
    return value;
  }
  return `${value.slice(0, 8)}…${value.slice(-6)}`;
}
