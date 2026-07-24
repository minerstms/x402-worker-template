import type { SettleResponse, SupportedResponse, VerifyResponse } from "@x402/core/types";
import { MAINNET_NETWORK } from "../../src/mainnet/payment-policy.mainnet.js";
import {
  MAINNET_PROOF_FACILITATOR,
  MAINNET_PROOF_FACILITATOR_MAX_RESPONSE_BYTES,
  buildProofFacilitatorCandidateUrl,
} from "../../src/mainnet/proof-facilitator-candidate.mainnet.js";

export type ProofFacilitatorMockOperation = "supported" | "verify" | "settle" | "unknown";

export type ProofFacilitatorMockLedgerEntry = {
  ordinal: number;
  method: string;
  path: string;
  operation: ProofFacilitatorMockOperation;
  responseMode: string;
  hasAuthorizationHeader: boolean;
  redirectDisabled: boolean;
  requestContentType?: string;
};

export type ProofFacilitatorMockFetchMode =
  | "json"
  | "redirect"
  | "missing-content-type"
  | "html"
  | "invalid-json"
  | "oversized-content-length"
  | "oversized-stream"
  | "dishonest-content-length"
  | "throw-network"
  | "throw-timeout"
  | "http-429"
  | "http-500";

export type ProofFacilitatorMockFetchOptions = {
  supportedResponse?: SupportedResponse;
  verifyResponse?: VerifyResponse | ProofFacilitatorMockFetchMode;
  settleResponse?: SettleResponse | ProofFacilitatorMockFetchMode;
  supportedMode?: ProofFacilitatorMockFetchMode;
  transactionHash?: string;
};

const DEFAULT_SUPPORTED: SupportedResponse = {
  kinds: [
    {
      x402Version: 2,
      scheme: "exact",
      network: MAINNET_NETWORK,
    },
  ],
  extensions: ["payment-identifier"],
  signers: {
    [MAINNET_NETWORK]: ["0x0000000000000000000000000000000000000001"],
  },
};

const DEFAULT_VERIFY: VerifyResponse = {
  isValid: true,
  payer: "0x1111111111111111111111111111111111111111",
};

function resolveOperation(url: URL): ProofFacilitatorMockOperation {
  switch (url.pathname) {
    case MAINNET_PROOF_FACILITATOR.supportedPath:
      return "supported";
    case MAINNET_PROOF_FACILITATOR.verifyPath:
      return "verify";
    case MAINNET_PROOF_FACILITATOR.settlePath:
      return "settle";
    default:
      return "unknown";
  }
}

function jsonResponse(body: unknown, status = 200, headers: Record<string, string> = {}): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: {
      "Content-Type": "application/json",
      ...headers,
    },
  });
}

function buildSettleResponse(transactionHash: string): SettleResponse {
  return {
    success: true,
    transaction: transactionHash,
    network: MAINNET_NETWORK,
    payer: "0x1111111111111111111111111111111111111111",
    amount: "1000",
  };
}

function resolveMode<T>(
  value: T | ProofFacilitatorMockFetchMode | undefined,
  fallback: T,
): { mode: ProofFacilitatorMockFetchMode | "json"; payload?: T } {
  if (value === undefined) {
    return { mode: "json", payload: fallback };
  }
  if (typeof value === "string") {
    return { mode: value as ProofFacilitatorMockFetchMode };
  }
  return { mode: "json", payload: value };
}

function buildModeResponse(
  mode: ProofFacilitatorMockFetchMode | "json",
  payload: unknown,
): Response {
  switch (mode) {
    case "json":
      return jsonResponse(payload);
    case "redirect":
      return Response.redirect(
        "https://example.com/redirect-target",
        302,
      );
    case "missing-content-type":
      return new Response(JSON.stringify(payload));
    case "html":
      return new Response("<html><body>not json</body></html>", {
        status: 200,
        headers: { "Content-Type": "text/html" },
      });
    case "invalid-json":
      return new Response("{not-json", {
        status: 200,
        headers: { "Content-Type": "application/json" },
      });
    case "oversized-content-length":
      return new Response("{}", {
        status: 200,
        headers: {
          "Content-Type": "application/json",
          "Content-Length": String(512 * 1024),
        },
      });
    case "oversized-stream":
      return new Response("x".repeat(512 * 1024), {
        status: 200,
        headers: { "Content-Type": "application/json" },
      });
    case "dishonest-content-length":
      return new Response("x".repeat(MAINNET_PROOF_FACILITATOR_MAX_RESPONSE_BYTES + 1), {
        status: 200,
        headers: {
          "Content-Type": "application/json",
          "Content-Length": "2",
        },
      });
    case "http-429":
      return jsonResponse({ error: "rate limited" }, 429);
    case "http-500":
      return jsonResponse({ error: "server error" }, 500);
    case "throw-network":
      return jsonResponse(payload);
    case "throw-timeout":
      return jsonResponse(payload);
    default:
      return jsonResponse(payload);
  }
}

export function createProofFacilitatorMockFetch(
  options: ProofFacilitatorMockFetchOptions = {},
): {
  fetch: typeof fetch;
  ledger: ProofFacilitatorMockLedgerEntry[];
  resetLedger: () => void;
} {
  const ledger: ProofFacilitatorMockLedgerEntry[] = [];
  let ordinal = 0;
  const transactionHash = options.transactionHash ?? `0x${"ab".repeat(32)}`;

  const fetchImpl = (async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = new URL(String(input), MAINNET_PROOF_FACILITATOR.origin);
    if (url.origin !== MAINNET_PROOF_FACILITATOR.origin) {
      throw new Error(`Unexpected facilitator origin in mock fetch: ${url.origin}`);
    }
    const operation = resolveOperation(url);
    const method = init?.method ?? "GET";
    const headers = new Headers(init?.headers);
    let responseMode = "json";
    let response: Response;

    if (operation === "supported") {
      const resolved = resolveMode(options.supportedMode, "json");
      responseMode = resolved.mode;
      if (resolved.mode === "json") {
        response = buildModeResponse("json", options.supportedResponse ?? DEFAULT_SUPPORTED);
      } else {
        response = buildModeResponse(resolved.mode, options.supportedResponse ?? DEFAULT_SUPPORTED);
      }
    } else if (operation === "verify") {
      const resolved = resolveMode(options.verifyResponse, DEFAULT_VERIFY);
      responseMode = resolved.mode;
      response = buildModeResponse(resolved.mode, resolved.payload ?? DEFAULT_VERIFY);
    } else if (operation === "settle") {
      const resolved = resolveMode(
        options.settleResponse,
        buildSettleResponse(transactionHash),
      );
      responseMode = resolved.mode;
      response = buildModeResponse(
        resolved.mode,
        resolved.payload ?? buildSettleResponse(transactionHash),
      );
    } else {
      responseMode = "unknown-path";
      throw new Error(`Unexpected facilitator path in mock fetch: ${url.pathname}`);
    }

    ordinal += 1;
    ledger.push({
      ordinal,
      method,
      path: url.pathname,
      operation,
      responseMode,
      hasAuthorizationHeader: headers.has("Authorization"),
      redirectDisabled: init?.redirect === "error",
      requestContentType: headers.get("Content-Type") ?? undefined,
    });

    if (init?.redirect === "error" && response.status >= 300 && response.status < 400) {
      throw new TypeError("redirect not allowed");
    }

    if (responseMode === "throw-network") {
      throw new TypeError("mock network failure");
    }
    if (responseMode === "throw-timeout") {
      throw new DOMException("Aborted", "AbortError");
    }

    return response;
  }) as typeof fetch;

  return {
    fetch: fetchImpl,
    ledger,
    resetLedger() {
      ledger.length = 0;
      ordinal = 0;
    },
  };
}

export function countLedgerOperations(
  ledger: ProofFacilitatorMockLedgerEntry[],
  operation: ProofFacilitatorMockOperation,
): number {
  return ledger.filter((entry) => entry.operation === operation).length;
}

export function ledgerEntriesForOperation(
  ledger: ProofFacilitatorMockLedgerEntry[],
  operation: ProofFacilitatorMockOperation,
): ProofFacilitatorMockLedgerEntry[] {
  return ledger.filter((entry) => entry.operation === operation);
}

export const PROOF_FACILITATOR_SUPPORTED_URL = buildProofFacilitatorCandidateUrl("/supported");
export const PROOF_FACILITATOR_VERIFY_URL = buildProofFacilitatorCandidateUrl("/verify");
export const PROOF_FACILITATOR_SETTLE_URL = buildProofFacilitatorCandidateUrl("/settle");
