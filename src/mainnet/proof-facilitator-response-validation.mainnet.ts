import type {
  Network,
  SettleResponse,
  SupportedResponse,
  VerifyResponse,
} from "@x402/core/types";
import { ProofFacilitatorAdapterError } from "./proof-facilitator-errors.mainnet.js";

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return (
    value !== null &&
    typeof value === "object" &&
    !Array.isArray(value) &&
    (Object.getPrototypeOf(value) === Object.prototype ||
      Object.getPrototypeOf(value) === null)
  );
}

function isOptionalStringRecord(value: unknown): value is Record<string, unknown> | undefined {
  if (value === undefined || value === null) {
    return true;
  }
  return isPlainObject(value);
}

function invalidSchema(message: string): never {
  throw new ProofFacilitatorAdapterError(message, "schema");
}

export function parseSupportedResponseJson(value: unknown): SupportedResponse {
  if (!isPlainObject(value)) {
    invalidSchema("Facilitator supported response must be an object.");
  }
  if (!Array.isArray(value.kinds)) {
    invalidSchema("Facilitator supported response kinds must be an array.");
  }
  const kinds = value.kinds.map((kind) => {
    if (!isPlainObject(kind)) {
      invalidSchema("Facilitator supported kind must be an object.");
    }
    if (typeof kind.x402Version !== "number") {
      invalidSchema("Facilitator supported kind x402Version must be a number.");
    }
    if (typeof kind.scheme !== "string") {
      invalidSchema("Facilitator supported kind scheme must be a string.");
    }
    if (typeof kind.network !== "string") {
      invalidSchema("Facilitator supported kind network must be a string.");
    }
    if (kind.extra !== undefined && kind.extra !== null && !isPlainObject(kind.extra)) {
      invalidSchema("Facilitator supported kind extra must be an object.");
    }
    return {
      x402Version: kind.x402Version,
      scheme: kind.scheme,
      network: kind.network as Network,
      ...(kind.extra === undefined || kind.extra === null ? {} : { extra: kind.extra }),
    };
  });
  const extensions = Array.isArray(value.extensions)
    ? value.extensions.map((entry) => {
        if (typeof entry !== "string") {
          invalidSchema("Facilitator supported extensions must be strings.");
        }
        return entry;
      })
    : [];
  const signers = isPlainObject(value.signers) ? value.signers : {};
  for (const [key, addresses] of Object.entries(signers)) {
    if (typeof key !== "string" || !Array.isArray(addresses)) {
      invalidSchema("Facilitator supported signers must map to string arrays.");
    }
    for (const address of addresses) {
      if (typeof address !== "string") {
        invalidSchema("Facilitator supported signer entries must be strings.");
      }
    }
  }
  return { kinds, extensions, signers: signers as Record<string, string[]> };
}

export function parseVerifyResponseJson(value: unknown): VerifyResponse {
  if (!isPlainObject(value)) {
    invalidSchema("Facilitator verify response must be an object.");
  }
  if (typeof value.isValid !== "boolean") {
    invalidSchema("Facilitator verify response isValid must be a boolean.");
  }
  if (value.invalidReason !== undefined && value.invalidReason !== null && typeof value.invalidReason !== "string") {
    invalidSchema("Facilitator verify response invalidReason must be a string.");
  }
  if (
    value.invalidMessage !== undefined &&
    value.invalidMessage !== null &&
    typeof value.invalidMessage !== "string"
  ) {
    invalidSchema("Facilitator verify response invalidMessage must be a string.");
  }
  if (value.payer !== undefined && value.payer !== null && typeof value.payer !== "string") {
    invalidSchema("Facilitator verify response payer must be a string.");
  }
  if (!isOptionalStringRecord(value.extensions)) {
    invalidSchema("Facilitator verify response extensions must be an object.");
  }
  if (!isOptionalStringRecord(value.extra)) {
    invalidSchema("Facilitator verify response extra must be an object.");
  }
  return {
    isValid: value.isValid,
    invalidReason: value.invalidReason ?? undefined,
    invalidMessage: value.invalidMessage ?? undefined,
    payer: value.payer ?? undefined,
    extensions: value.extensions ?? undefined,
    extra: value.extra ?? undefined,
  };
}

export function parseSettleResponseJson(value: unknown): SettleResponse {
  if (!isPlainObject(value)) {
    invalidSchema("Facilitator settle response must be an object.");
  }
  if (typeof value.success !== "boolean") {
    invalidSchema("Facilitator settle response success must be a boolean.");
  }
  if (value.errorReason !== undefined && value.errorReason !== null && typeof value.errorReason !== "string") {
    invalidSchema("Facilitator settle response errorReason must be a string.");
  }
  if (
    value.errorMessage !== undefined &&
    value.errorMessage !== null &&
    typeof value.errorMessage !== "string"
  ) {
    invalidSchema("Facilitator settle response errorMessage must be a string.");
  }
  if (value.payer !== undefined && value.payer !== null && typeof value.payer !== "string") {
    invalidSchema("Facilitator settle response payer must be a string.");
  }
  if (typeof value.transaction !== "string") {
    invalidSchema("Facilitator settle response transaction must be a string.");
  }
  if (typeof value.network !== "string") {
    invalidSchema("Facilitator settle response network must be a string.");
  }
  if (value.amount !== undefined && value.amount !== null && typeof value.amount !== "string") {
    invalidSchema("Facilitator settle response amount must be a string.");
  }
  if (!isOptionalStringRecord(value.extensions)) {
    invalidSchema("Facilitator settle response extensions must be an object.");
  }
  if (!isOptionalStringRecord(value.extra)) {
    invalidSchema("Facilitator settle response extra must be an object.");
  }
  return {
    success: value.success,
    errorReason: value.errorReason ?? undefined,
    errorMessage: value.errorMessage ?? undefined,
    payer: value.payer ?? undefined,
    transaction: value.transaction,
    network: value.network as Network,
    amount: value.amount ?? undefined,
    extensions: value.extensions ?? undefined,
    extra: value.extra ?? undefined,
  };
}

export function parseFacilitatorJsonResponse(
  operation: "supported" | "verify" | "settle",
  value: unknown,
): SupportedResponse | VerifyResponse | SettleResponse {
  switch (operation) {
    case "supported":
      return parseSupportedResponseJson(value);
    case "verify":
      return parseVerifyResponseJson(value);
    case "settle":
      return parseSettleResponseJson(value);
    default:
      throw new ProofFacilitatorAdapterError("Unknown facilitator operation.", "internal");
  }
}
