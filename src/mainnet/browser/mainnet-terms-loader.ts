import { decodePaymentRequiredHeader } from "@x402/core/http";
import type { PaymentRequired, PaymentRequirements } from "@x402/core/types";
import { sanitizeBrowserString } from "../../browser/sanitize-error.js";
import {
  MAINNET_CHAIN_ID_DECIMAL,
  MAINNET_NETWORK,
  MAINNET_PAID_QUERY_KEY,
  MAINNET_PAID_ROUTE,
  MAINNET_PAYMENT_AMOUNT,
  MAINNET_PAYMENT_DISPLAY,
  MAINNET_USDC_EIP712_NAME,
  MAINNET_USDC_EIP712_VERSION,
  validateBaseMainnetPaymentRequirements,
  type MainnetPolicyConfig,
} from "../payment-policy.mainnet.js";
import { validateRequiredPaymentIdentifierDeclaration } from "../idempotency/payment-identifier-validation.js";

export type MainnetPaymentSummary = {
  paying: string;
  network: string;
  service: string;
  input: string;
  sellerStatus: "verified";
  tokenStatus: "verified";
  amountStatus: "verified";
  eip712Status: "verified";
  timeoutStatus: "verified";
  optionsCount: 1;
  paymentIdentifierRequired: true;
};

export type MainnetValidatedTerms = {
  paymentRequired: PaymentRequired;
  requirement: PaymentRequirements;
  requestUrl: string;
  queryValue: string;
  summary: MainnetPaymentSummary;
};

export type MainnetTermsLoadResult =
  | { ok: true; terms: MainnetValidatedTerms }
  | { ok: false; reason: string };

export function buildMainnetPaidRouteUrl(origin: string, queryValue: string): string {
  const url = new URL(origin);
  url.pathname = MAINNET_PAID_ROUTE;
  url.search = "";
  url.searchParams.set(MAINNET_PAID_QUERY_KEY, queryValue);
  return url.toString();
}

export async function loadAndValidateMainnetTerms(options: {
  fetchImpl: typeof fetch;
  origin: string;
  policy: MainnetPolicyConfig;
  queryValue?: string;
}): Promise<MainnetTermsLoadResult> {
  const queryValue = options.queryValue ?? "hello";
  const requestUrl = buildMainnetPaidRouteUrl(options.origin, queryValue);
  const expectedOrigin = new URL(options.origin).origin;

  let response: Response;
  try {
    response = await options.fetchImpl(requestUrl, {
      method: "GET",
      headers: { Accept: "application/json" },
      redirect: "error",
    });
  } catch (error) {
    return {
      ok: false,
      reason:
        error instanceof Error
          ? sanitizeBrowserString(error.message)
          : "The unpaid request failed because a redirect was attempted.",
    };
  }

  if (response.status === 200) {
    return {
      ok: false,
      reason: "Expected HTTP 402 before payment, but received HTTP 200.",
    };
  }

  if (response.status !== 402) {
    return {
      ok: false,
      reason: `Expected HTTP 402, received HTTP ${response.status}.`,
    };
  }

  const paymentHeader =
    response.headers.get("payment-required") ??
    response.headers.get("PAYMENT-REQUIRED");
  if (!paymentHeader) {
    return {
      ok: false,
      reason: "Missing payment-required header on unpaid response.",
    };
  }

  let paymentRequired: PaymentRequired;
  try {
    paymentRequired = decodePaymentRequiredHeader(paymentHeader) as PaymentRequired;
  } catch {
    return {
      ok: false,
      reason: "Could not decode payment-required header.",
    };
  }

  const resourceUrl = paymentRequired.resource?.url;
  if (typeof resourceUrl !== "string") {
    return { ok: false, reason: "Payment resource URL is missing." };
  }

  let parsedResourceUrl: URL;
  try {
    parsedResourceUrl = new URL(resourceUrl);
  } catch {
    return { ok: false, reason: "Payment resource URL is invalid." };
  }

  if (parsedResourceUrl.origin !== expectedOrigin) {
    return { ok: false, reason: "Payment resource origin does not match." };
  }
  if (parsedResourceUrl.pathname !== MAINNET_PAID_ROUTE) {
    return { ok: false, reason: "Payment resource path does not match." };
  }
  if (!parsedResourceUrl.searchParams.has(MAINNET_PAID_QUERY_KEY)) {
    return { ok: false, reason: "Payment resource query key is missing." };
  }
  if (parsedResourceUrl.searchParams.get(MAINNET_PAID_QUERY_KEY) !== queryValue) {
    return { ok: false, reason: "Payment resource query value does not match." };
  }

  const validation = validateBaseMainnetPaymentRequirements(
    paymentRequired.accepts,
    options.policy.sellerAddress,
  );
  if (!validation.ok) {
    return validation;
  }

  const identifierDeclaration = validateRequiredPaymentIdentifierDeclaration(
    paymentRequired.extensions,
  );
  if (!identifierDeclaration.ok) {
    return identifierDeclaration;
  }

  return {
    ok: true,
    terms: {
      paymentRequired,
      requirement: validation.requirement,
      requestUrl,
      queryValue,
      summary: {
        paying: MAINNET_PAYMENT_DISPLAY,
        network: `${MAINNET_NETWORK} (${MAINNET_CHAIN_ID_DECIMAL})`,
        service: MAINNET_PAID_ROUTE,
        input: queryValue,
        sellerStatus: "verified",
        tokenStatus: "verified",
        amountStatus: "verified",
        eip712Status: "verified",
        timeoutStatus: "verified",
        optionsCount: 1,
        paymentIdentifierRequired: true,
      },
    },
  };
}
