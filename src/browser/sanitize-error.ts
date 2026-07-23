const ADDRESS_PATTERN = /\b0x[0-9a-fA-F]{40}\b/g;
const PRIVATE_KEY_PATTERN = /\b0x[0-9a-fA-F]{64}\b/g;
const LONG_HEX_PATTERN = /\b0x[0-9a-fA-F]{96,}\b/g;
const USER_REJECTION_CODES = new Set<number | string>([
  4001,
  "4001",
  "ACTION_REJECTED",
]);

export type SafeBrowserError = {
  category: "provider" | "viem" | "x402" | "fetch" | "settlement" | "policy";
  stage: string;
  message: string;
  userRejected: boolean;
  httpStatus?: number;
  submissionMayHaveBegun: boolean;
};

export function shortenAddress(address: string): string {
  if (address.length < 10) {
    return address;
  }
  return `${address.slice(0, 6)}…${address.slice(-4)}`;
}

function extractErrorCode(error: unknown): number | string | undefined {
  if (error && typeof error === "object") {
    const candidate = error as { code?: unknown; cause?: unknown };
    if (typeof candidate.code === "number" || typeof candidate.code === "string") {
      return candidate.code;
    }
    if (candidate.cause) {
      return extractErrorCode(candidate.cause);
    }
  }
  return undefined;
}

function extractHttpStatus(error: unknown): number | undefined {
  if (error && typeof error === "object") {
    const candidate = error as { status?: unknown; statusCode?: unknown };
    if (typeof candidate.status === "number") return candidate.status;
    if (typeof candidate.statusCode === "number") return candidate.statusCode;
  }
  return undefined;
}

function extractRawMessage(error: unknown): string {
  if (error instanceof Error) {
    return error.message;
  }
  return String(error);
}

function classifyErrorCategory(error: unknown): SafeBrowserError["category"] {
  const message = extractRawMessage(error).toLowerCase();
  if (message.includes("payment creation aborted") || message.includes("x402")) {
    return "x402";
  }
  if (message.includes("fetch") || message.includes("network")) {
    return "fetch";
  }
  if (message.includes("settlement") || message.includes("payment-response")) {
    return "settlement";
  }
  if (message.includes("typed data") || message.includes("chain")) {
    return "viem";
  }
  return "provider";
}

export function sanitizeBrowserString(value: string): string {
  let sanitized = value.slice(0, 240);
  sanitized = sanitized.replace(PRIVATE_KEY_PATTERN, "[redacted]");
  sanitized = sanitized.replace(LONG_HEX_PATTERN, "[redacted]");
  sanitized = sanitized.replace(ADDRESS_PATTERN, "[redacted]");
  sanitized = sanitized.replace(
    /payment-required|payment-signature|authorization|typed data|seed phrase|mnemonic/gi,
    "[redacted]",
  );
  return sanitized.trim() || "An unexpected browser error occurred.";
}

export function sanitizeProviderErrorMessage(error: unknown): string {
  return sanitizeBrowserString(extractRawMessage(error));
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

export function classifyBrowserError(
  error: unknown,
  stage: string,
  options: { submissionStarted?: boolean } = {},
): SafeBrowserError {
  const provider = classifyProviderError(error);
  return {
    category: classifyErrorCategory(error),
    stage,
    message: provider.message,
    userRejected: provider.kind === "rejected",
    httpStatus: extractHttpStatus(error),
    submissionMayHaveBegun: Boolean(options.submissionStarted),
  };
}

export function containsPrivateData(value: string): boolean {
  return (
    PRIVATE_KEY_PATTERN.test(value) ||
    ADDRESS_PATTERN.test(value) ||
    LONG_HEX_PATTERN.test(value) ||
    /payment-required|payment-signature|authorization|typed data|seed phrase|mnemonic/i.test(
      value,
    )
  );
}

export function sanitizeForDom(value: unknown): string {
  if (value === null || value === undefined) {
    return "";
  }
  if (typeof value === "string") {
    return sanitizeBrowserString(value);
  }
  if (typeof value === "number" || typeof value === "boolean") {
    return String(value);
  }
  return "An error occurred.";
}
