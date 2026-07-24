import {
  applyBaseSepoliaPaymentPolicy,
  BASE_SEPOLIA,
  BASE_SEPOLIA_MAX_TIMEOUT_SECONDS,
  BASE_SEPOLIA_PAYMENT_AMOUNT,
  BASE_SEPOLIA_USDC_ASSET,
  createBaseSepoliaPaymentPolicy,
  matchesBaseSepoliaPaymentTerms,
  requirement,
  selectBaseSepoliaPaymentRequirement,
  validateBaseSepoliaPaymentRequirements,
} from "./payment-policy.js";
import {
  ALLOWED_QUERY_KEY,
  PAID_ROUTE,
} from "./pay-public-config.js";
import { EXAMPLE_VALUE_MAX_LENGTH } from "./routes/example.js";

export {
  applyBaseSepoliaPaymentPolicy,
  BASE_SEPOLIA,
  BASE_SEPOLIA_MAX_TIMEOUT_SECONDS,
  BASE_SEPOLIA_PAYMENT_AMOUNT,
  BASE_SEPOLIA_USDC_ASSET,
  createBaseSepoliaPaymentPolicy,
  matchesBaseSepoliaPaymentTerms,
  requirement,
  selectBaseSepoliaPaymentRequirement,
  validateBaseSepoliaPaymentRequirements,
};
export const BUYER_FETCH_REDIRECT = "error" as const;
export const PRIVATE_KEY_PATTERN = /^0x[0-9a-fA-F]{64}$/;
export const ADDRESS_PATTERN = /^0x[a-fA-F0-9]{40}$/;

export type BuyerGuardConfig = {
  apiUrl: string | undefined;
  evmPrivateKey: string | undefined;
  allowTestnetPayment: boolean;
  expectedPayToAddress: string | undefined;
  network: string;
  expectedRemoteApiOrigin?: string | undefined;
};

export type BuyerGuardResult =
  | { ok: true }
  | { ok: false; reason: string };

export function parseBoolFlag(value: string | undefined): boolean {
  return (value ?? "").trim().toLowerCase() === "true";
}

export function validatePrivateKeyFormat(
  value: string | undefined,
): BuyerGuardResult {
  if (!value || !value.trim()) {
    return {
      ok: false,
      reason: "EVM_PRIVATE_KEY is absent. Refusing to construct a signer.",
    };
  }
  if (!PRIVATE_KEY_PATTERN.test(value.trim())) {
    return {
      ok: false,
      reason:
        "EVM_PRIVATE_KEY must be a 0x-prefixed 64-character hexadecimal string.",
    };
  }
  return { ok: true };
}

export function validateExpectedPayToAddress(
  value: string | undefined,
): BuyerGuardResult {
  if (!value || !value.trim()) {
    return {
      ok: false,
      reason: "EXPECTED_PAY_TO_ADDRESS is required.",
    };
  }
  if (!ADDRESS_PATTERN.test(value.trim())) {
    return {
      ok: false,
      reason:
        "EXPECTED_PAY_TO_ADDRESS must be a 0x-prefixed 40-character hexadecimal address.",
    };
  }
  return { ok: true };
}

function validatePaidRoutePathAndQuery(url: URL): BuyerGuardResult {
  if (url.pathname !== PAID_ROUTE) {
    return {
      ok: false,
      reason: `API_URL pathname must be ${PAID_ROUTE}.`,
    };
  }

  const queryKeys = [...url.searchParams.keys()];
  if (queryKeys.length !== 1 || queryKeys[0] !== ALLOWED_QUERY_KEY) {
    return {
      ok: false,
      reason: `API_URL must include exactly one ${ALLOWED_QUERY_KEY} query parameter.`,
    };
  }

  const values = url.searchParams.getAll(ALLOWED_QUERY_KEY);
  if (values.length !== 1) {
    return {
      ok: false,
      reason: `API_URL must include exactly one ${ALLOWED_QUERY_KEY} query parameter.`,
    };
  }

  const value = values[0]!;
  if (
    value !== value.trim() ||
    value.length === 0 ||
    value.length > EXAMPLE_VALUE_MAX_LENGTH
  ) {
    return {
      ok: false,
      reason: `API_URL ${ALLOWED_QUERY_KEY} query parameter is invalid.`,
    };
  }

  return { ok: true };
}

export function validateExpectedRemoteApiOrigin(
  value: string | undefined,
): BuyerGuardResult {
  if (!value || !value.trim()) {
    return { ok: true };
  }

  let url: URL;
  try {
    url = new URL(value.trim());
  } catch {
    return {
      ok: false,
      reason: "EXPECTED_REMOTE_API_ORIGIN must be a valid URL.",
    };
  }

  if (url.protocol !== "https:") {
    return {
      ok: false,
      reason: "EXPECTED_REMOTE_API_ORIGIN must use https:.",
    };
  }
  if (url.username || url.password) {
    return {
      ok: false,
      reason: "EXPECTED_REMOTE_API_ORIGIN must not contain credentials.",
    };
  }
  if (url.pathname !== "/" && url.pathname !== "") {
    return {
      ok: false,
      reason: "EXPECTED_REMOTE_API_ORIGIN must not include a path.",
    };
  }
  if (url.search || url.hash) {
    return {
      ok: false,
      reason:
        "EXPECTED_REMOTE_API_ORIGIN must not include query or fragment.",
    };
  }
  if (!url.hostname.endsWith(".workers.dev")) {
    return {
      ok: false,
      reason:
        "EXPECTED_REMOTE_API_ORIGIN hostname must end with .workers.dev.",
    };
  }

  return { ok: true };
}

export function validateApiUrl(
  value: string | undefined,
  expectedRemoteApiOrigin?: string | undefined,
): BuyerGuardResult {
  if (!value || !value.trim()) {
    return { ok: false, reason: "API_URL is required." };
  }

  let url: URL;
  try {
    url = new URL(value.trim());
  } catch {
    return { ok: false, reason: "API_URL must be a valid URL." };
  }

  if (url.username || url.password) {
    return {
      ok: false,
      reason: "API_URL must not contain embedded credentials.",
    };
  }
  if (url.hash) {
    return { ok: false, reason: "API_URL must not contain a fragment." };
  }

  const route = validatePaidRoutePathAndQuery(url);
  if (!route.ok) return route;

  const isLocal =
    url.protocol === "http:" &&
    (url.hostname === "localhost" || url.hostname === "127.0.0.1") &&
    url.port === "8787";

  if (isLocal) {
    return { ok: true };
  }

  const remoteOrigin = (expectedRemoteApiOrigin ?? "").trim();
  if (!remoteOrigin) {
    return {
      ok: false,
      reason:
        "API_URL must target localhost or 127.0.0.1 unless EXPECTED_REMOTE_API_ORIGIN is configured.",
    };
  }

  const originConfig = validateExpectedRemoteApiOrigin(remoteOrigin);
  if (!originConfig.ok) return originConfig;

  if (url.protocol !== "https:") {
    return { ok: false, reason: "Remote API_URL must use https:." };
  }

  const configuredOrigin = new URL(remoteOrigin);
  if (url.origin !== configuredOrigin.origin) {
    return {
      ok: false,
      reason: "API_URL origin must exactly match EXPECTED_REMOTE_API_ORIGIN.",
    };
  }

  if (!url.hostname.endsWith(".workers.dev")) {
    return {
      ok: false,
      reason: "Remote API_URL hostname must end with .workers.dev.",
    };
  }

  return { ok: true };
}

/** @deprecated Use validateApiUrl for local-only checks. */
export function validateLocalApiUrl(value: string | undefined): BuyerGuardResult {
  return validateApiUrl(value, undefined);
}

/**
 * Phase 1 buyer guards. Base Sepolia only; never constructs a signer.
 */
export function evaluateBuyerGuards(
  config: BuyerGuardConfig,
): BuyerGuardResult {
  const origin = validateExpectedRemoteApiOrigin(config.expectedRemoteApiOrigin);
  if (!origin.ok) return origin;

  const api = validateApiUrl(config.apiUrl, config.expectedRemoteApiOrigin);
  if (!api.ok) return api;

  const key = validatePrivateKeyFormat(config.evmPrivateKey);
  if (!key.ok) return key;

  const payTo = validateExpectedPayToAddress(config.expectedPayToAddress);
  if (!payTo.ok) return payTo;

  if (!config.allowTestnetPayment) {
    return {
      ok: false,
      reason: "Payments are refused unless ALLOW_TESTNET_PAYMENT=true.",
    };
  }

  if (config.network !== BASE_SEPOLIA) {
    return {
      ok: false,
      reason: `Phase 1 buyer supports only ${BASE_SEPOLIA}.`,
    };
  }

  return { ok: true };
}

