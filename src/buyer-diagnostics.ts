import type { PaymentRequirements } from "@x402/core/types";

export const GENERIC_BUYER_ERROR =
  "Buyer script failed. Check configuration and try again.";

export const BUYER_STAGES = [
  "load_environment",
  "validate_guards",
  "construct_account",
  "construct_x402_client",
  "construct_wrapped_fetch",
  "initial_unpaid_request",
  "decode_payment_requirements",
  "validate_payment_policy",
  "create_payment_payload",
  "encode_payment_header",
  "submit_paid_request",
  "read_resource_response",
  "decode_settlement_response",
  "emit_success_output",
] as const;

export type BuyerStage = (typeof BUYER_STAGES)[number];

export type BuyerFailurePhase =
  | "before_account_construction"
  | "before_signing"
  | "during_local_signing"
  | "before_paid_submission"
  | "during_paid_submission"
  | "during_settlement_parsing"
  | "during_success_output";

export type RedactionContext = {
  privateKey?: string;
  buyerAddress?: string;
  sellerAddress?: string;
  envValues?: Record<string, string | undefined>;
};

export type SafeBuyerDiagnostic = {
  stage: BuyerStage;
  failurePhase: BuyerFailurePhase;
  errorClass: string;
  errorCode?: string;
  message: string;
  httpStatus?: number;
  rpcMethod?: string;
  networkId?: number | string;
  paymentBearingRequestLikelySent: boolean;
  diagnosticId: string;
};

const PRIVATE_KEY_PATTERN = /\b0x[0-9a-fA-F]{64}\b/g;
const ADDRESS_PATTERN = /\b0x[0-9a-fA-F]{40}\b/g;
const LONG_HEX_PATTERN = /\b0x[0-9a-fA-F]{96,}\b/g;
const SENSITIVE_ENV_KEYS = new Set([
  "EVM_PRIVATE_KEY",
  "API_URL",
  "EXPECTED_PAY_TO_ADDRESS",
  "EXPECTED_REMOTE_API_ORIGIN",
]);

export function resolveFailurePhase(stage: BuyerStage): BuyerFailurePhase {
  switch (stage) {
    case "load_environment":
    case "validate_guards":
      return "before_account_construction";
    case "construct_account":
    case "construct_x402_client":
    case "construct_wrapped_fetch":
    case "initial_unpaid_request":
    case "decode_payment_requirements":
    case "validate_payment_policy":
      return "before_signing";
    case "create_payment_payload":
      return "during_local_signing";
    case "encode_payment_header":
      return "before_paid_submission";
    case "submit_paid_request":
      return "during_paid_submission";
    case "read_resource_response":
    case "decode_settlement_response":
      return "during_settlement_parsing";
    case "emit_success_output":
      return "during_success_output";
    default:
      return "before_signing";
  }
}

export function inferStageFromError(
  error: unknown,
  currentStage: BuyerStage,
): BuyerStage {
  const message = extractRawMessage(error);
  if (message.includes("Failed to parse payment requirements")) {
    return "decode_payment_requirements";
  }
  if (message.includes("Failed to create payment payload")) {
    return "create_payment_payload";
  }
  if (message.includes("Payment already attempted")) {
    return "submit_paid_request";
  }
  if (message.includes("payment-response present but could not be decoded")) {
    return "decode_settlement_response";
  }
  return currentStage;
}

export function paymentPayloadPrerequisites(
  requirement: PaymentRequirements,
): { ok: true } | { ok: false; reason: string } {
  const extra = requirement.extra ?? {};
  if (!extra.name || !extra.version) {
    return {
      ok: false,
      reason:
        "Payment requirements are missing EIP-712 domain parameters (extra.name and extra.version) required for exact EVM signing.",
    };
  }
  return { ok: true };
}

function extractRawMessage(error: unknown): string {
  if (error instanceof Error) {
    return [error.message, ...collectCauseMessages(error.cause)].join(" | ");
  }
  return String(error);
}

function collectCauseMessages(cause: unknown): string[] {
  if (!cause) return [];
  if (cause instanceof Error) {
    return [cause.message, ...collectCauseMessages(cause.cause)];
  }
  return [String(cause)];
}

function extractErrorCode(error: unknown): string | undefined {
  if (error && typeof error === "object") {
    const candidate = error as {
      code?: unknown;
      shortMessage?: unknown;
      details?: unknown;
    };
    if (typeof candidate.code === "string") return candidate.code;
    if (typeof candidate.code === "number") return String(candidate.code);
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

function extractRpcMethod(error: unknown): string | undefined {
  const message = extractRawMessage(error);
  const match = message.match(/\b(eth_[a-zA-Z0-9_]+|wallet_[a-zA-Z0-9_]+)\b/);
  return match?.[1];
}

function extractNetworkId(error: unknown): number | string | undefined {
  if (error && typeof error === "object") {
    const candidate = error as { chainId?: unknown; network?: unknown };
    if (typeof candidate.chainId === "number" || typeof candidate.chainId === "string") {
      return candidate.chainId;
    }
    if (typeof candidate.network === "string") return candidate.network;
  }
  return undefined;
}

export function paymentBearingRequestLikelySent(stage: BuyerStage): boolean {
  return stage === "submit_paid_request" ||
    stage === "read_resource_response" ||
    stage === "decode_settlement_response";
}

export function sanitizeBuyerValue(
  value: unknown,
  context: RedactionContext = {},
): unknown {
  if (value === null || value === undefined) return value;
  if (typeof value === "string") {
    return sanitizeBuyerString(value, context);
  }
  if (typeof value === "number" || typeof value === "boolean") {
    return value;
  }
  if (Array.isArray(value)) {
    return value.map((entry) => sanitizeBuyerValue(entry, context));
  }
  if (typeof value === "object") {
    const out: Record<string, unknown> = {};
    for (const [key, entry] of Object.entries(value as Record<string, unknown>)) {
      if (/authorization|private|secret|signature|seed|mnemonic|payment-signature|payment-required|x-payment|cookie|token|api[_-]?key/i.test(key)) {
        out[key] = "[REDACTED]";
        continue;
      }
      if (context.envValues && key in context.envValues) {
        out[key] = "[REDACTED]";
        continue;
      }
      out[key] = sanitizeBuyerValue(entry, context);
    }
    return out;
  }
  return "[OMITTED]";
}

export function sanitizeBuyerString(
  value: string,
  context: RedactionContext = {},
): string {
  let sanitized = value;
  if (context.privateKey) {
    sanitized = sanitized.split(context.privateKey).join("[REDACTED]");
  }
  if (context.buyerAddress) {
    sanitized = sanitized.split(context.buyerAddress).join("[REDACTED]");
    sanitized = sanitized
      .split(context.buyerAddress.toLowerCase())
      .join("[REDACTED]");
  }
  if (context.sellerAddress) {
    sanitized = sanitized.split(context.sellerAddress).join("[REDACTED]");
    sanitized = sanitized
      .split(context.sellerAddress.toLowerCase())
      .join("[REDACTED]");
  }
  if (context.envValues) {
    for (const envValue of Object.values(context.envValues)) {
      if (envValue && envValue.length > 0) {
        sanitized = sanitized.split(envValue).join("[REDACTED]");
      }
    }
  }
  sanitized = sanitized.replace(PRIVATE_KEY_PATTERN, "[REDACTED]");
  sanitized = sanitized.replace(LONG_HEX_PATTERN, "[REDACTED]");
  for (const address of collectRedactionAddresses(context)) {
    sanitized = sanitized.split(address).join("[REDACTED]");
    sanitized = sanitized.split(address.toLowerCase()).join("[REDACTED]");
  }
  sanitized = sanitized.replace(ADDRESS_PATTERN, "[REDACTED]");
  return sanitized;
}

function collectRedactionAddresses(context: RedactionContext): string[] {
  const addresses = new Set<string>();
  if (context.buyerAddress) addresses.add(context.buyerAddress);
  if (context.sellerAddress) addresses.add(context.sellerAddress);
  if (context.envValues?.EXPECTED_PAY_TO_ADDRESS) {
    addresses.add(context.envValues.EXPECTED_PAY_TO_ADDRESS);
  }
  return [...addresses];
}

export function createDiagnosticId(stage: BuyerStage): string {
  return `buyer-${stage}-${Date.now().toString(36)}`;
}

export function extractBuyerErrorDiagnostic(
  error: unknown,
  stage: BuyerStage,
  context: RedactionContext = {},
): SafeBuyerDiagnostic {
  const inferredStage = inferStageFromError(error, stage);
  const rawMessage = extractRawMessage(error);
  const sanitizedMessage = sanitizeBuyerString(rawMessage, context).slice(0, 240);
  return {
    stage: inferredStage,
    failurePhase: resolveFailurePhase(inferredStage),
    errorClass:
      error instanceof Error ? error.name || "Error" : typeof error,
    errorCode: extractErrorCode(error),
    message: sanitizedMessage || "Unknown buyer failure",
    httpStatus: extractHttpStatus(error),
    rpcMethod: extractRpcMethod(error),
    networkId: extractNetworkId(error),
    paymentBearingRequestLikelySent:
      paymentBearingRequestLikelySent(inferredStage),
    diagnosticId: createDiagnosticId(inferredStage),
  };
}

export function buildBuyerErrorReport(
  error: unknown,
  stage: BuyerStage,
  context: RedactionContext = {},
): {
  level: "error";
  message: string;
  diagnostic: SafeBuyerDiagnostic;
} {
  return {
    level: "error",
    message: GENERIC_BUYER_ERROR,
    diagnostic: extractBuyerErrorDiagnostic(error, stage, context),
  };
}

export function sanitizeSettlement(value: unknown): unknown {
  return sanitizeBuyerValue(value);
}

export function sanitizeSuccessPayload(
  payload: Record<string, unknown>,
  context: RedactionContext,
): Record<string, unknown> {
  const sanitized = sanitizeBuyerValue(payload, context);
  return sanitized as Record<string, unknown>;
}

export function redactEnvSnapshot(
  env: Record<string, string | undefined>,
): Record<string, string | undefined> {
  const out: Record<string, string | undefined> = {};
  for (const [key, value] of Object.entries(env)) {
    out[key] = SENSITIVE_ENV_KEYS.has(key) ? "[REDACTED]" : value;
  }
  return out;
}
