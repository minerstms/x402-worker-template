import type { PaymentPayload, PaymentRequirements } from "@x402/core/types";
import {
  MAINNET_PROOF_FACILITATOR,
  MAINNET_PROOF_FACILITATOR_MAX_RESPONSE_BYTES,
  type MainnetProofFacilitatorPath,
} from "./proof-facilitator-candidate.mainnet.js";
import {
  ProofFacilitatorAdapterError,
  toSafeFacilitatorTransportError,
} from "./proof-facilitator-errors.mainnet.js";
import { parseFacilitatorJsonResponse } from "./proof-facilitator-response-validation.mainnet.js";

export type ProofFacilitatorOperation = "supported" | "verify" | "settle";

const OPERATION_PATH: Record<ProofFacilitatorOperation, MainnetProofFacilitatorPath> = {
  supported: MAINNET_PROOF_FACILITATOR.supportedPath,
  verify: MAINNET_PROOF_FACILITATOR.verifyPath,
  settle: MAINNET_PROOF_FACILITATOR.settlePath,
};

export function buildFixedProofFacilitatorUrl(
  path: MainnetProofFacilitatorPath,
): URL {
  const url = new URL(path, MAINNET_PROOF_FACILITATOR.origin);
  assertFixedProofFacilitatorUrl(url, path);
  return url;
}

export function assertFixedProofFacilitatorUrl(
  url: URL,
  expectedPath: MainnetProofFacilitatorPath,
): void {
  if (url.origin !== MAINNET_PROOF_FACILITATOR.origin) {
    throw new ProofFacilitatorAdapterError(
      "Facilitator origin must match the reviewed proof candidate.",
      "invalid-origin",
    );
  }
  if (url.protocol !== "https:") {
    throw new ProofFacilitatorAdapterError(
      "Facilitator requests must use HTTPS.",
      "invalid-origin",
    );
  }
  if (url.username || url.password) {
    throw new ProofFacilitatorAdapterError(
      "Facilitator URL credentials are not permitted.",
      "invalid-origin",
    );
  }
  if (url.port && url.port !== "443") {
    throw new ProofFacilitatorAdapterError(
      "Facilitator URL port must remain the HTTPS default.",
      "invalid-origin",
    );
  }
  if (url.pathname !== expectedPath) {
    throw new ProofFacilitatorAdapterError(
      "Facilitator path must match the reviewed proof candidate endpoint.",
      "invalid-path",
    );
  }
  if (url.search) {
    throw new ProofFacilitatorAdapterError(
      "Facilitator URL query parameters are not permitted.",
      "invalid-path",
    );
  }
  if (url.hash) {
    throw new ProofFacilitatorAdapterError(
      "Facilitator URL fragments are not permitted.",
      "invalid-path",
    );
  }
}

export function isJsonContentType(contentType: string | null): boolean {
  if (!contentType) {
    return false;
  }
  const mediaType = contentType.split(";")[0]?.trim().toLowerCase();
  return mediaType === "application/json";
}

export async function readBoundedResponseBody(
  response: Response,
  maxBytes: number,
): Promise<Uint8Array> {
  const contentLength = response.headers.get("content-length");
  if (contentLength) {
    const parsed = Number(contentLength);
    if (!Number.isFinite(parsed) || parsed < 0 || parsed > maxBytes) {
      throw new ProofFacilitatorAdapterError(
        "Facilitator response body exceeds size limit.",
        "oversized-body",
      );
    }
  }

  if (!response.body) {
    return new Uint8Array();
  }

  const reader = response.body.getReader();
  const chunks: Uint8Array[] = [];
  let total = 0;
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) {
        break;
      }
      total += value.byteLength;
      if (total > maxBytes) {
        await reader.cancel();
        throw new ProofFacilitatorAdapterError(
          "Facilitator response body exceeds size limit.",
          "oversized-body",
        );
      }
      chunks.push(value);
    }
  } finally {
    reader.releaseLock();
  }

  const output = new Uint8Array(total);
  let offset = 0;
  for (const chunk of chunks) {
    output.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return output;
}

export function toJsonSafe<T>(value: T): T {
  return JSON.parse(
    JSON.stringify(value, (_key, nested) =>
      typeof nested === "bigint" ? nested.toString() : nested,
    ),
  ) as T;
}

export type ProofFacilitatorFetchRequest = {
  operation: ProofFacilitatorOperation;
  fetchImpl: typeof fetch;
  timeoutMs: number;
  maxResponseBytes?: number;
  paymentPayload?: PaymentPayload;
  paymentRequirements?: PaymentRequirements;
};

export async function executeProofFacilitatorRequest(
  request: ProofFacilitatorFetchRequest,
): Promise<Response> {
  const path = OPERATION_PATH[request.operation];
  const url = buildFixedProofFacilitatorUrl(path);
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), request.timeoutMs);
  const headers: Record<string, string> = {
    Accept: "application/json",
  };
  let body: string | undefined;
  if (request.operation === "supported") {
    if (request.paymentPayload || request.paymentRequirements) {
      throw new ProofFacilitatorAdapterError(
        "Facilitator supported request must not include payment payload.",
        "internal",
      );
    }
  } else {
    if (!request.paymentPayload || !request.paymentRequirements) {
      throw new ProofFacilitatorAdapterError(
        "Facilitator payment request payload is missing.",
        "internal",
      );
    }
    headers["Content-Type"] = "application/json";
    body = JSON.stringify({
      x402Version: request.paymentPayload.x402Version,
      paymentPayload: toJsonSafe(request.paymentPayload),
      paymentRequirements: toJsonSafe(request.paymentRequirements),
    });
  }

  try {
    const response = await request.fetchImpl(url.toString(), {
      method: request.operation === "supported" ? "GET" : "POST",
      headers,
      body,
      redirect: "error",
      signal: controller.signal,
    });
    if (response.url) {
      assertFixedProofFacilitatorUrl(new URL(response.url), path);
    } else if (response.status >= 300 && response.status < 400) {
      throw new ProofFacilitatorAdapterError(
        "Facilitator redirect responses are not permitted.",
        "redirect",
      );
    }
    return response;
  } catch (error) {
    throw toSafeFacilitatorTransportError(error);
  } finally {
    clearTimeout(timeout);
  }
}

export async function readValidatedFacilitatorJsonResponse<T>(
  response: Response,
  operation: ProofFacilitatorOperation,
  maxResponseBytes: number,
): Promise<T> {
  if (response.status >= 300 && response.status < 400) {
    throw new ProofFacilitatorAdapterError(
      "Facilitator redirect responses are not permitted.",
      "redirect",
    );
  }
  if (!isJsonContentType(response.headers.get("content-type"))) {
    throw new ProofFacilitatorAdapterError(
      "Facilitator response must use application/json.",
      "content-type",
    );
  }
  const bodyBytes = await readBoundedResponseBody(response, maxResponseBytes);
  let parsed: unknown;
  try {
    parsed = JSON.parse(new TextDecoder().decode(bodyBytes));
  } catch {
    throw new ProofFacilitatorAdapterError(
      "Facilitator response JSON is invalid.",
      "invalid-json",
    );
  }
  return parseFacilitatorJsonResponse(operation, parsed) as T;
}
