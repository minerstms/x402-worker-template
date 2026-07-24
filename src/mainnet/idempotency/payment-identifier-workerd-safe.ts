/**
 * Validates payment-identifier extension structure without runtime JSON Schema
 * compilation. Mirrors the hand-written checks in @x402/extensions
 * validatePaymentIdentifier() and enforces the same constraints as
 * paymentIdentifierSchema without invoking AJV.
 *
 * This module intentionally avoids runtime AJV compilation for workerd safety.
 * Any upgrade to @x402/extensions requires a parity review against
 * test/mainnet-payment-identifier-drift.test.ts before release.
 */
import type { PaymentPayload } from "@x402/core/types";
import {
  PAYMENT_IDENTIFIER,
  extractPaymentIdentifier,
  isValidPaymentId,
} from "@x402/extensions/payment-identifier";

export type WorkerdSafePaymentIdentifierValidation =
  | { valid: true }
  | { valid: false; errors: string[] };

export function validatePaymentIdentifierExtensionWithoutSchemaCompile(
  extension: unknown,
): WorkerdSafePaymentIdentifierValidation {
  if (!extension || typeof extension !== "object") {
    return { valid: false, errors: ["Extension must be an object"] };
  }

  const ext = extension as { info?: unknown };
  if (!ext.info || typeof ext.info !== "object") {
    return {
      valid: false,
      errors: ["Extension must have an 'info' property"],
    };
  }

  const info = ext.info as { required?: unknown; id?: unknown };
  if (typeof info.required !== "boolean") {
    return {
      valid: false,
      errors: ["Extension info must have a 'required' boolean property"],
    };
  }

  if (info.id !== undefined && typeof info.id !== "string") {
    return {
      valid: false,
      errors: ["Extension info 'id' must be a string if provided"],
    };
  }

  if (info.id !== undefined && !isValidPaymentId(info.id)) {
    return {
      valid: false,
      errors: [
        "Invalid payment ID format. ID must be 16-128 characters and contain only alphanumeric characters, hyphens, and underscores.",
      ],
    };
  }

  return { valid: true };
}

export function extractPaymentIdentifierWithoutSchemaCompile(
  paymentPayload: PaymentPayload,
): {
  id: string | null;
  validation: WorkerdSafePaymentIdentifierValidation;
} {
  if (!paymentPayload.extensions) {
    return { id: null, validation: { valid: true } };
  }

  const extension = paymentPayload.extensions[PAYMENT_IDENTIFIER];
  if (!extension) {
    return { id: null, validation: { valid: true } };
  }

  const validation =
    validatePaymentIdentifierExtensionWithoutSchemaCompile(extension);
  if (!validation.valid) {
    return { id: null, validation };
  }

  const id = extractPaymentIdentifier(paymentPayload, true);
  return { id, validation: { valid: true } };
}
