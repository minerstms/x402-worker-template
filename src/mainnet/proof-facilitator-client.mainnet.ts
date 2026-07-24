import { HTTPFacilitatorClient } from "@x402/core/server";
import {
  assertMainnetProofCandidateInactive,
  MAINNET_PROOF_FACILITATOR,
} from "./proof-facilitator-candidate.mainnet.js";

/**
 * Production-shaped HTTPFacilitatorClient for the reviewed PayAI proof candidate.
 * Not wired into the disabled production mainnet entry. Tests and future bounded
 * proof tasks construct this explicitly; live verify/settle remain out of scope here.
 */
export function createProofFacilitatorCandidateHttpClient(): HTTPFacilitatorClient {
  assertMainnetProofCandidateInactive();
  return new HTTPFacilitatorClient({
    url: MAINNET_PROOF_FACILITATOR.origin,
  });
}
