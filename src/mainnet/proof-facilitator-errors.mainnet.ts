export type ProofFacilitatorAdapterErrorCategory =
  | "invalid-origin"
  | "invalid-path"
  | "redirect"
  | "timeout"
  | "network"
  | "http-status"
  | "content-type"
  | "oversized-body"
  | "invalid-json"
  | "schema"
  | "internal";

export class ProofFacilitatorAdapterError extends Error {
  readonly category: ProofFacilitatorAdapterErrorCategory;

  constructor(message: string, category: ProofFacilitatorAdapterErrorCategory) {
    super(message);
    this.name = "ProofFacilitatorAdapterError";
    this.category = category;
  }
}

export function toSafeFacilitatorTransportError(
  error: unknown,
  fallbackCategory: ProofFacilitatorAdapterErrorCategory = "internal",
): ProofFacilitatorAdapterError {
  if (error instanceof ProofFacilitatorAdapterError) {
    return error;
  }
  if (error instanceof DOMException && error.name === "AbortError") {
    return new ProofFacilitatorAdapterError(
      "Facilitator request timed out.",
      "timeout",
    );
  }
  if (error instanceof TypeError) {
    return new ProofFacilitatorAdapterError(
      "Facilitator network request failed.",
      "network",
    );
  }
  return new ProofFacilitatorAdapterError(
    "Facilitator request failed.",
    fallbackCategory,
  );
}
