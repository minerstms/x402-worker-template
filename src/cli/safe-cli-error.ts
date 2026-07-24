const PRIVATE_KEY_PATTERN = /0x[a-fA-F0-9]{64}/g;
const ADDRESS_PATTERN = /0x[a-fA-F0-9]{40}/g;
const PAYMENT_HEADER_PATTERN = /PAYMENT-(?:SIGNATURE|REQUIRED|RESPONSE):\s*[^\s]+/gi;
const API_KEY_PATTERN = /(?:api[_-]?key|sk_[A-Za-z0-9]+|payai_sk_[A-Za-z0-9+/=]+)/gi;
const CREDENTIAL_URL_PATTERN = /https?:\/\/[^\s]*(?:@|:)[^\s]*/gi;
const MAX_SAFE_MESSAGE_LENGTH = 240;

function redactSensitiveText(value: string): string {
  return value
    .replace(PRIVATE_KEY_PATTERN, "[REDACTED_PRIVATE_KEY]")
    .replace(PAYMENT_HEADER_PATTERN, "[REDACTED_PAYMENT_HEADER]")
    .replace(API_KEY_PATTERN, "[REDACTED_API_KEY]")
    .replace(CREDENTIAL_URL_PATTERN, "[REDACTED_URL]")
    .replace(ADDRESS_PATTERN, "[REDACTED_ADDRESS]")
    .slice(0, MAX_SAFE_MESSAGE_LENGTH);
}

export type SafeCliErrorOutput = {
  level: "error";
  message: string;
  stage?: string;
};

export function formatSafeCliError(options: {
  stage?: string;
  message?: string;
  error?: unknown;
}): SafeCliErrorOutput {
  const fallbackMessage =
    options.message ?? "Command failed. Check configuration and try again.";
  const rawMessage =
    options.error instanceof Error ? options.error.message : fallbackMessage;
  return {
    level: "error",
    message: redactSensitiveText(rawMessage || fallbackMessage),
    ...(options.stage ? { stage: options.stage } : {}),
  };
}

export function formatSafeCliErrorJson(options: {
  stage?: string;
  message?: string;
  error?: unknown;
  extra?: Record<string, unknown>;
}): string {
  const safe = formatSafeCliError(options);
  const payload = {
    ...options.extra,
    ...safe,
  };
  return JSON.stringify(payload, null, 2);
}
