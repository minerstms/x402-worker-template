import type { SettleResponse } from "@x402/core/types";
import { MAINNET_NETWORK } from "../mainnet-config.js";

const TRANSACTION_HASH_PATTERN = /^0x[0-9a-fA-F]{64}$/;

export type StoredSettlementReceipt = {
  success: true;
  transaction: string;
  network: string;
  payer?: string;
  amount?: string;
};

export type SettlementReceiptValidationResult =
  | { ok: true; receipt: StoredSettlementReceipt }
  | { ok: false; reason: string };

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return (
    value !== null &&
    typeof value === "object" &&
    !Array.isArray(value) &&
    (Object.getPrototypeOf(value) === Object.prototype ||
      Object.getPrototypeOf(value) === null)
  );
}

export function validateSettlementReceiptForStorage(
  value: unknown,
): SettlementReceiptValidationResult {
  if (!isPlainObject(value)) {
    return { ok: false, reason: "Settlement receipt must be an object." };
  }

  if (value.success !== true) {
    return { ok: false, reason: "Settlement receipt must report success." };
  }

  if (typeof value.transaction !== "string") {
    return { ok: false, reason: "Settlement receipt transaction is missing." };
  }
  if (!TRANSACTION_HASH_PATTERN.test(value.transaction)) {
    return {
      ok: false,
      reason: "Settlement receipt transaction must be a 32-byte hex hash.",
    };
  }

  if (typeof value.network !== "string") {
    return { ok: false, reason: "Settlement receipt network is missing." };
  }
  if (value.network !== MAINNET_NETWORK) {
    return { ok: false, reason: "Settlement receipt network is not Base mainnet." };
  }

  const receipt: StoredSettlementReceipt = {
    success: true,
    transaction: value.transaction,
    network: value.network,
  };

  if (value.payer !== undefined) {
    if (typeof value.payer !== "string") {
      return { ok: false, reason: "Settlement receipt payer must be a string." };
    }
    receipt.payer = value.payer;
  }

  if (value.amount !== undefined) {
    if (typeof value.amount !== "string") {
      return { ok: false, reason: "Settlement receipt amount must be a string." };
    }
    receipt.amount = value.amount;
  }

  return { ok: true, receipt };
}

export function parseStoredSettlementReceipt(
  json: string | null,
): SettlementReceiptValidationResult {
  if (!json) {
    return { ok: false, reason: "Settlement receipt is missing." };
  }

  try {
    return validateSettlementReceiptForStorage(JSON.parse(json));
  } catch {
    return { ok: false, reason: "Settlement receipt JSON is malformed." };
  }
}

export function storedReceiptToSettleResponse(
  receipt: StoredSettlementReceipt,
): SettleResponse {
  const response: SettleResponse = {
    success: true,
    transaction: receipt.transaction,
    network: receipt.network as SettleResponse["network"],
  };
  if (receipt.payer) {
    response.payer = receipt.payer;
  }
  if (receipt.amount) {
    response.amount = receipt.amount;
  }
  return response;
}
