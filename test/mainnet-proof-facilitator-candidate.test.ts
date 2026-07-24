import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import {
  buildProofFacilitatorCandidateUrl,
  describeMainnetProofFacilitatorStatus,
  MAINNET_PAID_ROUTE_ENABLED,
  MAINNET_PAYMENT_READY,
  MAINNET_PRODUCTION_FACILITATOR_SELECTED,
  MAINNET_PROOF_FACILITATOR,
  MAINNET_PROOF_FACILITATOR_STATUS,
  MAINNET_REAL_PAYMENT_COMPATIBILITY,
} from "../src/mainnet/proof-facilitator-candidate.mainnet.js";
import {
  PayAIProofFacilitatorAdapter,
  createProofFacilitatorCandidateHttpClient,
} from "../src/mainnet/proof-facilitator-client.mainnet.js";

const ROOT = join(import.meta.dirname, "..");

function readRepoFile(relativePath: string): string {
  return readFileSync(join(ROOT, relativePath), "utf8");
}

describe("mainnet proof facilitator candidate", () => {
  it("pins PayAI as the immutable proof candidate", () => {
    expect(MAINNET_PROOF_FACILITATOR).toEqual({
      name: "PayAI",
      origin: "https://facilitator.payai.network",
      supportedPath: "/supported",
      verifyPath: "/verify",
      settlePath: "/settle",
    });
    expect(buildProofFacilitatorCandidateUrl("/supported")).toBe(
      "https://facilitator.payai.network/supported",
    );
    expect(buildProofFacilitatorCandidateUrl("/verify")).toBe(
      "https://facilitator.payai.network/verify",
    );
    expect(buildProofFacilitatorCandidateUrl("/settle")).toBe(
      "https://facilitator.payai.network/settle",
    );
  });

  it("keeps production activation flags false", () => {
    expect(MAINNET_PROOF_FACILITATOR_STATUS).toBe("candidate-not-live-verified");
    expect(MAINNET_PRODUCTION_FACILITATOR_SELECTED).toBe(false);
    expect(MAINNET_PAID_ROUTE_ENABLED).toBe(false);
    expect(MAINNET_PAYMENT_READY).toBe(false);
    expect(MAINNET_REAL_PAYMENT_COMPATIBILITY).toBe("not-yet-empirically-proven");
    expect(describeMainnetProofFacilitatorStatus()).toEqual({
      proofFacilitatorCandidate: "PayAI",
      candidateOrigin: "https://facilitator.payai.network",
      proofFacilitatorStatus: "candidate-not-live-verified",
      productionFacilitatorSelected: false,
      mainnetPaidRouteEnabled: false,
      mainnetPaymentReady: false,
      realPaymentCompatibility: "not-yet-empirically-proven",
    });
  });

  it("constructs the exact-origin adapter for the candidate only", () => {
    const client = createProofFacilitatorCandidateHttpClient({
      fetchImpl: (() => {
        throw new Error("injected fetch required in tests");
      }) as typeof fetch,
    });
    expect(client).toBeInstanceOf(PayAIProofFacilitatorAdapter);
    expect(client.url).toBe("https://facilitator.payai.network");
  });

  it("does not wire the proof adapter into the production mainnet entry", () => {
    const source = readRepoFile("src/index.mainnet.ts");
    expect(source).not.toContain("HTTPFacilitatorClient");
    expect(source).not.toContain("createProofFacilitatorCandidateHttpClient");
    expect(source).not.toContain("facilitator.payai.network");
    expect(source).not.toContain("proof-facilitator-client");
    expect(source).toContain('code: "NOT_ENABLED"');
  });

  it("documents proof candidate status without selecting production facilitator", () => {
    const readme = readRepoFile("README.md");
    const doc = readRepoFile("docs/mainnet-proof-facilitator-candidate.md");
    expect(readme).toMatch(/proof facilitator candidate/i);
    expect(readme).toMatch(/production facilitator is not selected/i);
    expect(readme).not.toMatch(/production facilitator was selected/i);
    expect(doc).toContain("candidate-not-live-verified");
    expect(doc).toContain("not yet empirically proven");
    expect(doc).not.toMatch(/production facilitator selected.*true/i);
  });

  it("does not configure PayAI in wrangler.mainnet.toml", () => {
    const toml = readRepoFile("wrangler.mainnet.toml");
    expect(toml.toLowerCase()).not.toContain("payai");
    expect(toml.toLowerCase()).not.toContain("facilitator");
  });
});
