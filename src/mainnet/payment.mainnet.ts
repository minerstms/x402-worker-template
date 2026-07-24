import type { RouteConfig } from "@x402/core/server";
import type { Network, PaymentRequirements } from "@x402/core/types";
import { declarePaymentIdentifierExtension, PAYMENT_IDENTIFIER } from "@x402/extensions/payment-identifier";
import {
  MAINNET_MAX_TIMEOUT_SECONDS,
  MAINNET_NETWORK,
  MAINNET_PAID_ROUTE,
  MAINNET_PAYMENT_AMOUNT,
  MAINNET_PAYMENT_SCHEME,
  MAINNET_USDC_ASSET,
  MAINNET_USDC_EIP712_NAME,
  MAINNET_USDC_EIP712_VERSION,
  type MainnetPolicyConfig,
} from "./payment-policy.mainnet.js";

export const MAINNET_EXAMPLE_ROUTE_PATTERN = `GET ${MAINNET_PAID_ROUTE}` as const;

export function buildMainnetExampleRouteConfig(
  policy: MainnetPolicyConfig,
): RouteConfig {
  return {
    accepts: {
      scheme: MAINNET_PAYMENT_SCHEME,
      price: {
        amount: MAINNET_PAYMENT_AMOUNT,
        asset: MAINNET_USDC_ASSET,
        extra: {
          name: MAINNET_USDC_EIP712_NAME,
          version: MAINNET_USDC_EIP712_VERSION,
        },
      },
      network: MAINNET_NETWORK as Network,
      payTo: policy.sellerAddress,
      maxTimeoutSeconds: MAINNET_MAX_TIMEOUT_SECONDS,
    },
    description: "Deterministic mainnet example response echoing input value.",
    mimeType: "application/json",
    extensions: {
      [PAYMENT_IDENTIFIER]: declarePaymentIdentifierExtension(true),
    },
  };
}

export function buildMainnetExamplePaymentOption(policy: MainnetPolicyConfig) {
  const accepts = buildMainnetExampleRouteConfig(policy).accepts;
  return Array.isArray(accepts) ? accepts[0]! : accepts;
}

export function buildMainnetExampleResourceInfo(requestUrl: string) {
  return {
    url: requestUrl,
    description: "Deterministic mainnet example response echoing input value.",
    mimeType: "application/json",
  };
}

export function buildMainnetExampleResponse(value: string) {
  return {
    success: true as const,
    service: "x402 Worker Template",
    input: { value },
    output: { value },
  };
}

export function buildMainnetExampleRequirement(
  policy: MainnetPolicyConfig,
): PaymentRequirements {
  return {
    scheme: MAINNET_PAYMENT_SCHEME,
    network: MAINNET_NETWORK,
    amount: MAINNET_PAYMENT_AMOUNT,
    asset: MAINNET_USDC_ASSET,
    payTo: policy.sellerAddress,
    maxTimeoutSeconds: MAINNET_MAX_TIMEOUT_SECONDS,
    extra: {
      name: MAINNET_USDC_EIP712_NAME,
      version: MAINNET_USDC_EIP712_VERSION,
    },
  };
}
