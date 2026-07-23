import { decodePaymentRequiredHeader } from "@x402/core/http";
import type { PaymentRequired } from "@x402/core/types";
import type { PayPublicConfig } from "../pay-public-config.js";
import { buildPaidExampleUrl } from "../pay-public-config.js";
import { validateBaseSepoliaPaymentRequirements } from "../payment-policy.js";
import type { PaymentSummary } from "./pay-wallet-state.js";

export type TermsLoadResult =
  | { ok: true; summary: PaymentSummary }
  | { ok: false; reason: string };

function decodeRequirements(headerValue: string) {
  const decoded = decodePaymentRequiredHeader(headerValue) as PaymentRequired;
  return decoded.accepts;
}

export async function loadAndValidatePaymentTerms(options: {
  fetchImpl: typeof fetch;
  origin: string;
  publicConfig: PayPublicConfig;
  queryValue?: string;
}): Promise<TermsLoadResult> {
  const url = buildPaidExampleUrl(
    options.origin,
    options.queryValue ?? "browser-demo",
  );

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

  let requirements;
  try {
    requirements = decodeRequirements(paymentHeader);
  } catch {
    return {
      ok: false,
      reason: "Could not decode payment-required header.",
    };
  }

  const validation = validateBaseSepoliaPaymentRequirements(
    requirements,
    options.publicConfig.sellerAddress,
  );
  if (!validation.ok) {
    return validation;
  }

  return {
    ok: true,
    summary: {
      paying: "0.001 test USDC",
      network: options.publicConfig.networkLabel,
      service: options.publicConfig.paidRoute,
      input: options.queryValue ?? "browser-demo",
      sellerStatus: options.publicConfig.paymentReady
        ? "verified"
        : "placeholder",
      tokenStatus: "verified",
      amountStatus: "verified",
      eip712Status: "verified",
      timeoutStatus: "verified",
      optionsCount: 1,
      renewal: "none",
      requestsAuthorized: 0,
    },
  };
}
