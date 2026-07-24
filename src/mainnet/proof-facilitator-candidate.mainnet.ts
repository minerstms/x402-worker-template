export const MAINNET_PROOF_FACILITATOR = {
  name: "PayAI",
  origin: "https://facilitator.payai.network",
  supportedPath: "/supported",
  verifyPath: "/verify",
  settlePath: "/settle",
} as const;

export const MAINNET_PROOF_FACILITATOR_STATUS =
  "candidate-not-live-verified" as const;

export const MAINNET_PRODUCTION_FACILITATOR_SELECTED = false as const;

export const MAINNET_PAID_ROUTE_ENABLED = false as const;

export const MAINNET_PAYMENT_READY = false as const;

export const MAINNET_PRODUCTION_SELLER_ACTIVATED = false as const;

export const MAINNET_PROOF_SELLER_SECRET_NAME = "MAINNET_SELLER_ADDRESS" as const;

export const MAINNET_REAL_PAYMENT_COMPATIBILITY =
  "not-yet-empirically-proven" as const;

export const MAINNET_PROOF_FACILITATOR_TIMEOUT_MS = 10_000 as const;

export const MAINNET_PROOF_FACILITATOR_MAX_RESPONSE_BYTES = 256 * 1024;

export type MainnetProofFacilitatorPath =
  | typeof MAINNET_PROOF_FACILITATOR.supportedPath
  | typeof MAINNET_PROOF_FACILITATOR.verifyPath
  | typeof MAINNET_PROOF_FACILITATOR.settlePath;

export function buildProofFacilitatorCandidateUrl(
  path: MainnetProofFacilitatorPath,
): string {
  return `${MAINNET_PROOF_FACILITATOR.origin}${path}`;
}

export function assertMainnetProofCandidateInactive(): void {
  if (MAINNET_PRODUCTION_FACILITATOR_SELECTED) {
    throw new Error(
      "Production facilitator selection is disabled in this repository revision.",
    );
  }
  if (MAINNET_PAID_ROUTE_ENABLED) {
    throw new Error("Mainnet paid-route activation is disabled in this repository revision.");
  }
  if (MAINNET_PAYMENT_READY) {
    throw new Error("Mainnet payment readiness is false in this repository revision.");
  }
}

export function describeMainnetProofFacilitatorStatus() {
  return {
    proofFacilitatorCandidate: MAINNET_PROOF_FACILITATOR.name,
    candidateOrigin: MAINNET_PROOF_FACILITATOR.origin,
    proofFacilitatorStatus: MAINNET_PROOF_FACILITATOR_STATUS,
    productionFacilitatorSelected: MAINNET_PRODUCTION_FACILITATOR_SELECTED,
    mainnetPaidRouteEnabled: MAINNET_PAID_ROUTE_ENABLED,
    mainnetPaymentReady: MAINNET_PAYMENT_READY,
    productionSellerActivated: MAINNET_PRODUCTION_SELLER_ACTIVATED,
    proofSellerSecretName: MAINNET_PROOF_SELLER_SECRET_NAME,
    realPaymentCompatibility: MAINNET_REAL_PAYMENT_COMPATIBILITY,
  } as const;
}
