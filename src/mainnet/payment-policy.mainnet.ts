import type { PaymentRequirements } from "@x402/core/types";

export const MAINNET_PAYMENT_SCHEME = "exact" as const;
export const MAINNET_NETWORK = "eip155:8453" as const;
export const MAINNET_CHAIN_ID_DECIMAL = 8453;
export const MAINNET_CHAIN_ID_HEX = "0x2105" as const;
export const MAINNET_USDC_ASSET = "0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913" as const;
export const MAINNET_USDC_DECIMALS = 6;
export const MAINNET_PAYMENT_AMOUNT = "1000" as const;
export const MAINNET_PAYMENT_DISPLAY = "0.001 USDC" as const;
export const MAINNET_USDC_EIP712_NAME = "USD Coin" as const;
export const MAINNET_USDC_EIP712_VERSION = "2" as const;
export const MAINNET_MAX_TIMEOUT_SECONDS = 300;
export const MAINNET_PAID_HTTP_METHOD = "GET" as const;
export const MAINNET_PAID_ROUTE = "/v1/example" as const;
export const MAINNET_PAID_QUERY_KEY = "value" as const;
export const MAINNET_PAYMENT_IDENTIFIER_REQUIRED = true;

export const BASE_SEPOLIA_NETWORK = "eip155:84532";
export const BRIDGED_BASE_USDC = "0xd9aAEc86B65D86f4A9253D8C8b1c1c1c1c1c1c1c";
export const BASE_SEPOLIA_USDC = "0x036CbD53842c5426634e7929541eC2318f3dCF7e";

export type MainnetPolicyConfig = {
  sellerAddress: string;
};

export type MainnetPaymentTermsValidationResult =
  | { ok: true; requirement: PaymentRequirements }
  | { ok: false; reason: string };

function normalizeAddress(address: string): string {
  return address.toLowerCase();
}

function readExtra(requirement: PaymentRequirements): Record<string, unknown> {
  return requirement.extra ?? {};
}

export function matchesBaseMainnetPaymentTerms(
  requirement: PaymentRequirements,
  sellerAddress: string,
): boolean {
  const extra = readExtra(requirement);
  return (
    requirement.scheme === MAINNET_PAYMENT_SCHEME &&
    requirement.network === MAINNET_NETWORK &&
    requirement.amount === MAINNET_PAYMENT_AMOUNT &&
    normalizeAddress(requirement.asset) === normalizeAddress(MAINNET_USDC_ASSET) &&
    normalizeAddress(requirement.payTo) === normalizeAddress(sellerAddress) &&
    requirement.maxTimeoutSeconds === MAINNET_MAX_TIMEOUT_SECONDS &&
    extra.name === MAINNET_USDC_EIP712_NAME &&
    extra.version === MAINNET_USDC_EIP712_VERSION
  );
}

export function validateBaseMainnetPaymentRequirements(
  requirements: PaymentRequirements[],
  sellerAddress: string,
): MainnetPaymentTermsValidationResult {
  if (requirements.length !== 1) {
    return {
      ok: false,
      reason: "Expected exactly one acceptable payment option.",
    };
  }

  const requirement = requirements[0]!;
  if (!matchesBaseMainnetPaymentTerms(requirement, sellerAddress)) {
    return {
      ok: false,
      reason: "Payment terms do not match the allowed Base mainnet policy.",
    };
  }

  return { ok: true, requirement };
}

export function createMainnetPaymentPolicy(
  sellerAddress: string,
): import("@x402/core/client").PaymentPolicy {
  return (_version, requirements) =>
    requirements.filter((requirement) =>
      matchesBaseMainnetPaymentTerms(requirement, sellerAddress),
    );
}

export const selectMainnetPaymentRequirement: import("@x402/core/client").SelectPaymentRequirements =
  (_version, requirements) => {
    if (requirements.length === 0) {
      throw new Error(
        "No payment requirement matched the allowed Base mainnet terms.",
      );
    }
    return requirements[0]!;
  };

export function rejectNonMainnetPaymentTerms(
  requirement: PaymentRequirements,
  sellerAddress: string,
): string | null {
  if (requirement.network === BASE_SEPOLIA_NETWORK) {
    return "Base Sepolia is not accepted on the mainnet path.";
  }
  if (requirement.network !== MAINNET_NETWORK) {
    return "Only Base mainnet (eip155:8453) is accepted.";
  }
  if (normalizeAddress(requirement.asset) === normalizeAddress(BRIDGED_BASE_USDC)) {
    return "Bridged Base USDC is not accepted.";
  }
  if (normalizeAddress(requirement.asset) === normalizeAddress(BASE_SEPOLIA_USDC)) {
    return "Test USDC is not accepted.";
  }
  if (readExtra(requirement).name === "USDC") {
    return "EIP-712 name USDC is not accepted.";
  }
  if (readExtra(requirement).version !== MAINNET_USDC_EIP712_VERSION) {
    return "EIP-712 version must be 2.";
  }
  if (requirement.amount !== MAINNET_PAYMENT_AMOUNT) {
    return "Payment amount must be 1000 atomic units.";
  }
  if (normalizeAddress(requirement.payTo) !== normalizeAddress(sellerAddress)) {
    return "Seller address does not match the configured mainnet policy.";
  }
  return null;
}
