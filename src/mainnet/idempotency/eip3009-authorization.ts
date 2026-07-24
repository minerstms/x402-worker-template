import type { PaymentPayload, PaymentRequirements } from "@x402/core/types";
import { MAINNET_NETWORK } from "../payment-policy.mainnet.js";

const EVM_ADDRESS_PATTERN = /^0x[0-9a-fA-F]{40}$/;
const BYTES32_PATTERN = /^0x[0-9a-fA-F]{64}$/;
const SIGNATURE_PATTERN = /^0x[0-9a-fA-F]+$/;

export type Eip3009AuthorizationFields = {
  from: string;
  to: string;
  value: string;
  validAfter: string;
  validBefore: string;
  nonce: string;
  signature: string;
};

export type Eip3009StructuralValidationResult =
  | { ok: true; authorization: Eip3009AuthorizationFields }
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

function normalizeAddress(address: string): string {
  return address.toLowerCase();
}

function isCanonicalNonNegativeIntegerString(value: string): boolean {
  if (!/^\d+$/.test(value)) {
    return false;
  }
  return BigInt(value) >= 0n;
}

function readStringField(
  object: Record<string, unknown>,
  field: string,
): string | null {
  const value = object[field];
  return typeof value === "string" ? value : null;
}

export function extractEip3009PayloadShape(
  paymentPayload: PaymentPayload,
): Record<string, unknown> | null {
  if (!isPlainObject(paymentPayload.payload)) {
    return null;
  }
  if ("permit2Authorization" in paymentPayload.payload) {
    return null;
  }
  return paymentPayload.payload;
}

export function validateEip3009AuthorizationStructure(
  paymentPayload: PaymentPayload,
  matchedRequirement: PaymentRequirements,
): Eip3009StructuralValidationResult {
  if (paymentPayload.payload && "permit2Authorization" in paymentPayload.payload) {
    return { ok: false, reason: "Permit2 transfer method is not accepted on mainnet." };
  }

  const payload = extractEip3009PayloadShape(paymentPayload);
  if (!payload) {
    return { ok: false, reason: "Payment payload must contain EIP-3009 authorization data." };
  }

  const authorizationRaw = payload.authorization;
  if (!isPlainObject(authorizationRaw)) {
    return { ok: false, reason: "Authorization object is missing." };
  }

  const from = readStringField(authorizationRaw, "from");
  const to = readStringField(authorizationRaw, "to");
  const value = readStringField(authorizationRaw, "value");
  const validAfter = readStringField(authorizationRaw, "validAfter");
  const validBefore = readStringField(authorizationRaw, "validBefore");
  const nonce = readStringField(authorizationRaw, "nonce");
  const signature = readStringField(payload, "signature");

  if (!from || !EVM_ADDRESS_PATTERN.test(from)) {
    return { ok: false, reason: "Authorization from address is invalid." };
  }
  if (!to || !EVM_ADDRESS_PATTERN.test(to)) {
    return { ok: false, reason: "Authorization to address is invalid." };
  }
  if (!value || !isCanonicalNonNegativeIntegerString(value)) {
    return { ok: false, reason: "Authorization value is invalid." };
  }
  if (!validAfter || !isCanonicalNonNegativeIntegerString(validAfter)) {
    return { ok: false, reason: "Authorization validAfter is invalid." };
  }
  if (!validBefore || !isCanonicalNonNegativeIntegerString(validBefore)) {
    return { ok: false, reason: "Authorization validBefore is invalid." };
  }
  if (!nonce || !BYTES32_PATTERN.test(nonce)) {
    return { ok: false, reason: "Authorization nonce must be a bytes32 hex value." };
  }
  if (!signature || !SIGNATURE_PATTERN.test(signature)) {
    return { ok: false, reason: "Authorization signature is missing or malformed." };
  }

  if (BigInt(validBefore) <= BigInt(validAfter)) {
    return { ok: false, reason: "Authorization validBefore must be later than validAfter." };
  }

  if (matchedRequirement.network !== MAINNET_NETWORK) {
    return { ok: false, reason: "Matched requirement network is not Base mainnet." };
  }

  if (normalizeAddress(to) !== normalizeAddress(matchedRequirement.payTo)) {
    return { ok: false, reason: "Authorization to address does not match server payTo." };
  }

  if (value !== matchedRequirement.amount) {
    return { ok: false, reason: "Authorization value does not match server amount." };
  }

  if (
    paymentPayload.accepted.asset &&
    normalizeAddress(paymentPayload.accepted.asset) !==
      normalizeAddress(matchedRequirement.asset)
  ) {
    return {
      ok: false,
      reason: "Accepted asset does not match server verifying contract.",
    };
  }

  return {
    ok: true,
    authorization: {
      from,
      to,
      value,
      validAfter,
      validBefore,
      nonce,
      signature,
    },
  };
}
