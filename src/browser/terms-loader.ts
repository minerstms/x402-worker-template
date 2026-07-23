import { decodePaymentRequiredHeader } from "@x402/core/http";
import type { PaymentRequired } from "@x402/core/types";
import type { PayPublicConfig } from "../pay-public-config.js";
import { buildPaidExampleUrl } from "../pay-public-config.js";
import { validateBaseSepoliaPaymentRequirements } from "../payment-policy.js";
import {
  createPaymentQuote,
  type PaymentQuote,
} from "./pay-quote.js";
import type { PaymentSummary } from "./pay-wallet-state.js";

export type TermsLoadResult =
  | { ok: true; quote: PaymentQuote; summary: PaymentSummary }
  | { ok: false; reason: string };

export async function loadAndValidatePaymentTerms(options: {
  fetchImpl: typeof fetch;
  origin: string;
  publicConfig: PayPublicConfig;
  account: string;
  chainId: number;
  queryValue?: string;
}): Promise<TermsLoadResult> {
  const queryValue = options.queryValue ?? "browser-demo";
  const url = buildPaidExampleUrl(options.origin, queryValue);

  let response: Response;
  try {
    response = await options.fetchImpl(url, {
      method: "GET",
      headers: { Accept: "application/json" },
      redirect: "error",
    });
  } catch {
    return {
      ok: false,
      reason: "The unpaid request failed because a redirect was attempted.",
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
    paymentRequired = decodePaymentRequiredHeader(
      paymentHeader,
    ) as PaymentRequired;
  } catch {
    return {
      ok: false,
      reason: "Could not decode payment-required header.",
    };
  }

  const validation = validateBaseSepoliaPaymentRequirements(
    paymentRequired.accepts,
    options.publicConfig.sellerAddress,
  );
  if (!validation.ok) {
    return validation;
  }

  const quote = createPaymentQuote({
    paymentRequired,
    requirement: validation.requirement,
    publicConfig: options.publicConfig,
    account: options.account,
    chainId: options.chainId,
    requestUrl: url,
    queryValue,
  });

  return {
    ok: true,
    quote,
    summary: quote.summary,
  };
}
