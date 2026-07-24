import type { FacilitatorClient } from "@x402/core/server";
import type {
  PaymentPayload,
  PaymentRequirements,
  SettleResponse,
  SupportedResponse,
  VerifyResponse,
} from "@x402/core/types";
import { SettleError, VerifyError } from "@x402/core/types";
import {
  assertMainnetProofCandidateInactive,
  MAINNET_PROOF_FACILITATOR,
  MAINNET_PROOF_FACILITATOR_MAX_RESPONSE_BYTES,
  MAINNET_PROOF_FACILITATOR_TIMEOUT_MS,
} from "./proof-facilitator-candidate.mainnet.js";
import {
  ProofFacilitatorAdapterError,
  toSafeFacilitatorTransportError,
} from "./proof-facilitator-errors.mainnet.js";
import {
  executeProofFacilitatorRequest,
  readBoundedResponseBody,
  readValidatedFacilitatorJsonResponse,
} from "./proof-facilitator-http.mainnet.js";

export type ProofFacilitatorAdapterOptions = {
  fetchImpl?: typeof fetch;
  timeoutMs?: number;
  maxResponseBytes?: number;
};

export class PayAIProofFacilitatorAdapter implements FacilitatorClient {
  readonly url = MAINNET_PROOF_FACILITATOR.origin;
  private readonly fetchImpl: typeof fetch;
  private readonly timeoutMs: number;
  private readonly maxResponseBytes: number;

  constructor(options: ProofFacilitatorAdapterOptions = {}) {
    assertMainnetProofCandidateInactive();
    this.fetchImpl = options.fetchImpl ?? fetch;
    this.timeoutMs = options.timeoutMs ?? MAINNET_PROOF_FACILITATOR_TIMEOUT_MS;
    this.maxResponseBytes =
      options.maxResponseBytes ?? MAINNET_PROOF_FACILITATOR_MAX_RESPONSE_BYTES;
  }

  async getSupported(): Promise<SupportedResponse> {
    const response = await this.request("supported");
    if (!response.ok) {
      throw new ProofFacilitatorAdapterError(
        "Facilitator supported request failed.",
        "http-status",
      );
    }
    return readValidatedFacilitatorJsonResponse<SupportedResponse>(
      response,
      "supported",
      this.maxResponseBytes,
    );
  }

  async verify(
    paymentPayload: PaymentPayload,
    paymentRequirements: PaymentRequirements,
  ): Promise<VerifyResponse> {
    const response = await this.request("verify", paymentPayload, paymentRequirements);
    if (response.ok) {
      return readValidatedFacilitatorJsonResponse<VerifyResponse>(
        response,
        "verify",
        this.maxResponseBytes,
      );
    }
    return this.handleVerifyFailure(response);
  }

  async settle(
    paymentPayload: PaymentPayload,
    paymentRequirements: PaymentRequirements,
  ): Promise<SettleResponse> {
    const response = await this.request("settle", paymentPayload, paymentRequirements);
    if (response.ok) {
      return readValidatedFacilitatorJsonResponse<SettleResponse>(
        response,
        "settle",
        this.maxResponseBytes,
      );
    }
    return this.handleSettleFailure(response);
  }

  private async request(
    operation: "supported" | "verify" | "settle",
    paymentPayload?: PaymentPayload,
    paymentRequirements?: PaymentRequirements,
  ): Promise<Response> {
    return executeProofFacilitatorRequest({
      operation,
      fetchImpl: this.fetchImpl,
      timeoutMs: this.timeoutMs,
      maxResponseBytes: this.maxResponseBytes,
      paymentPayload,
      paymentRequirements,
    });
  }

  private async handleVerifyFailure(response: Response): Promise<never> {
    const parsed = await this.tryParseErrorBody(response);
    if (parsed && typeof parsed === "object" && "isValid" in parsed) {
      throw new VerifyError(response.status, parsed as VerifyResponse);
    }
    throw new ProofFacilitatorAdapterError(
      "Facilitator verify request failed.",
      "http-status",
    );
  }

  private async handleSettleFailure(response: Response): Promise<never> {
    const parsed = await this.tryParseErrorBody(response);
    if (parsed && typeof parsed === "object" && "success" in parsed) {
      throw new SettleError(response.status, parsed as SettleResponse);
    }
    throw new ProofFacilitatorAdapterError(
      "Facilitator settle request failed.",
      "http-status",
    );
  }

  private async tryParseErrorBody(response: Response): Promise<unknown | null> {
    try {
      const bodyBytes = await readBoundedResponseBody(response, this.maxResponseBytes);
      if (bodyBytes.byteLength === 0) {
        return null;
      }
      return JSON.parse(new TextDecoder().decode(bodyBytes));
    } catch (error) {
      if (error instanceof ProofFacilitatorAdapterError) {
        return null;
      }
      throw toSafeFacilitatorTransportError(error, "invalid-json");
    }
  }
}

/**
 * Exact-origin PayAI proof facilitator adapter with injected transport.
 * Not wired into the disabled production mainnet entry.
 */
export function createProofFacilitatorCandidateHttpClient(
  options: ProofFacilitatorAdapterOptions = {},
): PayAIProofFacilitatorAdapter {
  return new PayAIProofFacilitatorAdapter(options);
}
