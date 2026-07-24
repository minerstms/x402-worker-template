import { canonicalizeJsonValue, sha256Hex } from "./canonical-json.js";

export type TermsFingerprintInput = {
  scheme: string;
  network: string;
  asset: string;
  amount: string;
  payTo: string;
  httpMethod: string;
  normalizedRoute: string;
  normalizedQuery: Record<string, string>;
};

export type AuthCommitmentInput = {
  network: string;
  from: string;
  authorizationNonce: string;
  to: string;
  value: string;
  validAfter: string;
  validBefore: string;
  verifyingContract: string;
};

export type ResourceIdentityInput = {
  httpMethod: string;
  normalizedRoute: string;
  normalizedQuery: Record<string, string>;
};

function normalizeQuery(query: Record<string, string>): Record<string, string> {
  const normalized: Record<string, string> = {};
  for (const key of Object.keys(query).sort()) {
    normalized[key] = query[key]!;
  }
  return normalized;
}

export async function buildTermsFingerprint(
  input: TermsFingerprintInput,
): Promise<string> {
  const payload = {
    scheme: input.scheme,
    network: input.network,
    asset: input.asset,
    amount: input.amount,
    payTo: input.payTo,
    httpMethod: input.httpMethod.toUpperCase(),
    normalizedRoute: input.normalizedRoute,
    normalizedQuery: normalizeQuery(input.normalizedQuery),
  };
  return sha256Hex(canonicalizeJsonValue(payload));
}

export async function buildAuthCommitment(
  input: AuthCommitmentInput,
): Promise<string> {
  const payload = {
    network: input.network,
    from: input.from,
    authorizationNonce: input.authorizationNonce,
    to: input.to,
    value: input.value,
    validAfter: input.validAfter,
    validBefore: input.validBefore,
    verifyingContract: input.verifyingContract,
  };
  return sha256Hex(canonicalizeJsonValue(payload));
}

export async function buildResourceIdentityHash(
  input: ResourceIdentityInput,
): Promise<string> {
  const payload = {
    httpMethod: input.httpMethod.toUpperCase(),
    normalizedRoute: input.normalizedRoute,
    normalizedQuery: normalizeQuery(input.normalizedQuery),
  };
  return sha256Hex(canonicalizeJsonValue(payload));
}

export async function buildRecordKey(
  paymentIdentifier: string,
  termsFingerprint: string,
): Promise<string> {
  return sha256Hex(`${paymentIdentifier}|${termsFingerprint}`);
}
