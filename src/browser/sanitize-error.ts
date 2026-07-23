const ADDRESS_PATTERN = /\b0x[0-9a-fA-F]{40}\b/g;
const PRIVATE_KEY_PATTERN = /\b0x[0-9a-fA-F]{64}\b/g;
const USER_REJECTION_CODES = new Set<number | string>([
  4001,
  "4001",
  "ACTION_REJECTED",
]);

export function shortenAddress(address: string): string {
  if (address.length < 10) {
    return address;
  }
  return `${address.slice(0, 6)}…${address.slice(-4)}`;
}

function extractErrorCode(error: unknown): number | string | undefined {
  if (error && typeof error === "object") {
    const candidate = error as { code?: unknown };
    if (typeof candidate.code === "number" || typeof candidate.code === "string") {
      return candidate.code;
    }
  }
  return undefined;
}

function extractRawMessage(error: unknown): string {
  if (error instanceof Error) {
    return error.message;
  }
  return String(error);
}

export function sanitizeProviderErrorMessage(error: unknown): string {
  let message = extractRawMessage(error).slice(0, 240);
  message = message.replace(PRIVATE_KEY_PATTERN, "[redacted]");
  message = message.replace(ADDRESS_PATTERN, "[redacted]");
  if (!message.trim()) {
    return "An unexpected wallet error occurred.";
  }
  return message;
}

export function classifyProviderError(error: unknown): {
  kind: "rejected" | "failure";
  message: string;
} {
  const code = extractErrorCode(error);
  if (code !== undefined && USER_REJECTION_CODES.has(code)) {
    return {
      kind: "rejected",
      message: "Wallet request was rejected.",
    };
  }
  return {
    kind: "failure",
    message: sanitizeProviderErrorMessage(error),
  };
}

export function containsPrivateData(value: string): boolean {
  return (
    PRIVATE_KEY_PATTERN.test(value) ||
    ADDRESS_PATTERN.test(value) ||
    /payment-required|payment-signature|authorization/i.test(value)
  );
}
