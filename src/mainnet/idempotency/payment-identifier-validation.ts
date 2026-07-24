import type { PaymentPayload, PaymentRequired } from "@x402/core/types";
import {
  extractAndValidatePaymentIdentifier,
  isPaymentIdentifierRequired,
  validatePaymentIdentifierRequirement,
} from "@x402/extensions/payment-identifier";

export type PaymentIdentifierValidationResult =
  | { ok: true; paymentIdentifier: string }
  | { ok: false; reason: string };

export function validateRequiredPaymentIdentifierDeclaration(
  declaredExtensions: Record<string, unknown> | undefined,
): { ok: true } | { ok: false; reason: string } {
  if (!isPaymentIdentifierRequired(declaredExtensions?.["payment-identifier"])) {
    return {
      ok: false,
      reason: "Server must declare payment identifier as required.",
    };
  }
  return { ok: true };
}

export function validatePaymentIdentifierBeforeReservation(
  paymentRequired: PaymentRequired,
  paymentPayload: PaymentPayload,
): PaymentIdentifierValidationResult {
  const declared = paymentRequired.extensions?.["payment-identifier"];
  if (!isPaymentIdentifierRequired(declared)) {
    return {
      ok: false,
      reason: "Payment identifier extension must be required.",
    };
  }

  const requirementCheck = validatePaymentIdentifierRequirement(
    paymentPayload,
    true,
  );
  if (!requirementCheck.valid) {
    return {
      ok: false,
      reason: requirementCheck.errors?.[0] ?? "Payment identifier is required.",
    };
  }

  const extracted = extractAndValidatePaymentIdentifier(paymentPayload);
  if (!extracted.validation.valid) {
    return {
      ok: false,
      reason: extracted.validation.errors?.[0] ?? "Payment identifier is malformed.",
    };
  }
  if (!extracted.id) {
    return { ok: false, reason: "Payment identifier is missing." };
  }

  return { ok: true, paymentIdentifier: extracted.id };
}
