import { isValidPaymentId } from "@x402/extensions/payment-identifier";

export function validatePaymentIdentifierForLookup(
  paymentIdentifier: string,
): boolean {
  return isValidPaymentId(paymentIdentifier);
}

export function redactPaymentIdentifierForLogs(
  paymentIdentifier: string,
): string {
  if (paymentIdentifier.length <= 8) {
    return "[redacted-id]";
  }
  return `${paymentIdentifier.slice(0, 4)}…${paymentIdentifier.slice(-4)}`;
}
