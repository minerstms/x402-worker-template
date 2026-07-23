import type {
  PaymentPolicy,
  SelectPaymentRequirements,
} from "@x402/core/client";
import type { PaymentRequirements } from "@x402/core/types";
import {
  ALLOWED_SELLER_NETWORK,
  BASE_SEPOLIA_MAX_TIMEOUT_SECONDS,
  BASE_SEPOLIA_PAYMENT_AMOUNT,
  BASE_SEPOLIA_USDC_ASSET,
  BASE_SEPOLIA_USDC_EIP712_NAME,
  BASE_SEPOLIA_USDC_EIP712_VERSION,
} from "./config.js";

export const BASE_SEPOLIA = ALLOWED_SELLER_NETWORK;
export {
  BASE_SEPOLIA_MAX_TIMEOUT_SECONDS,
  BASE_SEPOLIA_PAYMENT_AMOUNT,
  BASE_SEPOLIA_USDC_ASSET,
  BASE_SEPOLIA_USDC_EIP712_NAME,
  BASE_SEPOLIA_USDC_EIP712_VERSION,
};

export type PaymentTermsValidationResult =
  | { ok: true; requirement: PaymentRequirements }
  | { ok: false; reason: string };

function normalizeAddress(address: string): string {
  return address.toLowerCase();
}

export function matchesBaseSepoliaPaymentTerms(
  requirement: PaymentRequirements,
  expectedPayToAddress: string,
): boolean {
  const extra = requirement.extra ?? {};
  return (
    requirement.scheme === "exact" &&
    requirement.network === ALLOWED_SELLER_NETWORK &&
    requirement.amount === BASE_SEPOLIA_PAYMENT_AMOUNT &&
    normalizeAddress(requirement.asset) ===
      normalizeAddress(BASE_SEPOLIA_USDC_ASSET) &&
    normalizeAddress(requirement.payTo) ===
      normalizeAddress(expectedPayToAddress) &&
    requirement.maxTimeoutSeconds === BASE_SEPOLIA_MAX_TIMEOUT_SECONDS &&
    extra.name === BASE_SEPOLIA_USDC_EIP712_NAME &&
    extra.version === BASE_SEPOLIA_USDC_EIP712_VERSION
  );
}

export function validateBaseSepoliaPaymentRequirements(
  requirements: PaymentRequirements[],
  expectedPayToAddress: string,
): PaymentTermsValidationResult {
  if (requirements.length !== 1) {
    return {
      ok: false,
      reason: "Expected exactly one acceptable payment option.",
    };
  }

  const requirement = requirements[0]!;
  if (!matchesBaseSepoliaPaymentTerms(requirement, expectedPayToAddress)) {
    return {
      ok: false,
      reason: "Payment terms do not match the allowed Base Sepolia policy.",
    };
  }

  return { ok: true, requirement };
}

export function createBaseSepoliaPaymentPolicy(
  expectedPayToAddress: string,
): PaymentPolicy {
  return (_version, requirements) =>
    requirements.filter((requirement) =>
      matchesBaseSepoliaPaymentTerms(requirement, expectedPayToAddress),
    );
}

export const selectBaseSepoliaPaymentRequirement: SelectPaymentRequirements = (
  _version,
  requirements,
) => {
  if (requirements.length === 0) {
    throw new Error(
      "No payment requirement matched the allowed Base Sepolia terms.",
    );
  }
  return requirements[0]!;
};

export function applyBaseSepoliaPaymentPolicy(
  requirements: PaymentRequirements[],
  expectedPayToAddress: string,
): PaymentRequirements[] {
  return createBaseSepoliaPaymentPolicy(expectedPayToAddress)(
    2,
    requirements,
  );
}

export function requirement(
  overrides: Partial<PaymentRequirements> = {},
): PaymentRequirements {
  return {
    scheme: "exact",
    network: ALLOWED_SELLER_NETWORK,
    amount: BASE_SEPOLIA_PAYMENT_AMOUNT,
    asset: BASE_SEPOLIA_USDC_ASSET,
    payTo: "0x000000000000000000000000000000000000dEaD",
    maxTimeoutSeconds: BASE_SEPOLIA_MAX_TIMEOUT_SECONDS,
    extra: {
      name: BASE_SEPOLIA_USDC_EIP712_NAME,
      version: BASE_SEPOLIA_USDC_EIP712_VERSION,
    },
    ...overrides,
  };
}
