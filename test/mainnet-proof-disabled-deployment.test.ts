import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import {
  MAINNET_PAID_ROUTE_ENABLED,
  MAINNET_PAYMENT_READY,
  MAINNET_PRODUCTION_FACILITATOR_SELECTED,
  MAINNET_PRODUCTION_SELLER_ACTIVATED,
  MAINNET_PROOF_SELLER_SECRET_NAME,
} from "../src/mainnet/proof-facilitator-candidate.mainnet.js";

const ROOT = join(import.meta.dirname, "..");
const EVM_ADDRESS = /\b0x[0-9a-fA-F]{40}\b/;

function readRepoFile(relativePath: string): string {
  return readFileSync(join(ROOT, relativePath), "utf8");
}

describe("mainnet proof-disabled deployment configuration", () => {
  const toml = readRepoFile("wrangler.mainnet-proof-disabled.toml");
  const mainnetEntry = readRepoFile("src/index.mainnet.ts");
  const proofCandidate = readRepoFile("src/mainnet/proof-facilitator-candidate.mainnet.ts");
  const doc = readRepoFile("docs/mainnet-proof-disabled-deployment.md");

  it("1 includes the dedicated disabled-proof Wrangler config", () => {
    expect(toml.length).toBeGreaterThan(0);
  });

  it("2 pins the exact Worker name", () => {
    expect(toml).toContain('name = "x402-worker-template-mainnet-proof-disabled"');
  });

  it("3 uses the disabled mainnet entry", () => {
    expect(toml).toContain('main = "src/index.mainnet.ts"');
  });

  it("4 enables workers.dev", () => {
    expect(toml).toContain("workers_dev = true");
  });

  it("5 declares no custom routes or domains", () => {
    expect(toml.toLowerCase()).not.toContain("routes");
    expect(toml.toLowerCase()).not.toContain("route =");
    expect(toml.toLowerCase()).not.toContain("custom_domain");
    expect(toml.toLowerCase()).not.toContain("zone_id");
  });

  it("6 contains no plaintext seller address", () => {
    expect(toml).not.toMatch(EVM_ADDRESS);
    expect(toml).not.toContain("[vars]");
  });

  it("7 documents the MAINNET_SELLER_ADDRESS binding name only", () => {
    expect(toml).toContain("MAINNET_SELLER_ADDRESS");
    expect(MAINNET_PROOF_SELLER_SECRET_NAME).toBe("MAINNET_SELLER_ADDRESS");
  });

  it("8 does not declare the seller as a Wrangler variable value", () => {
    expect(toml).not.toMatch(/MAINNET_SELLER_ADDRESS\s*=\s*"/);
  });

  it("9 keeps the dedicated config free of full EVM address literals", () => {
    expect(toml).not.toMatch(EVM_ADDRESS);
    expect(doc).not.toMatch(EVM_ADDRESS);
  });

  it("10 includes no PayAI credential or authentication secret", () => {
    expect(toml.toLowerCase()).not.toMatch(/api[_-]?key|bearer|authorization|jwt|payai.*secret/);
  });

  it("11 includes no facilitator override", () => {
    expect(toml.toLowerCase()).not.toContain("facilitator");
    expect(toml.toLowerCase()).not.toContain("payai");
  });

  it("12 includes no network override", () => {
    expect(toml.toLowerCase()).not.toMatch(/x402_network|eip155|8453/);
  });

  it("13 includes no token override", () => {
    expect(toml.toLowerCase()).not.toMatch(/usdc|833589/);
  });

  it("14 includes no Base RPC URL", () => {
    expect(toml.toLowerCase()).not.toMatch(/base.*rpc|mainnet\.base|8453.*http/);
  });

  it("15 includes no buyer configuration", () => {
    expect(toml.toLowerCase()).not.toMatch(/buyer|private_key|evm_private/);
  });

  it("16 uses only additive Durable Object migration", () => {
    expect(toml).toContain("new_sqlite_classes");
    expect(toml).not.toContain("deleted_classes");
    expect(toml).not.toContain("renamed_classes");
  });

  it("17 declares only the reviewed Durable Object binding", () => {
    expect(toml).toContain("PAYMENT_COORDINATOR");
    expect(toml).toContain("PaymentCoordinatorDurableObject");
    expect(toml.toLowerCase()).not.toContain("kv_namespaces");
    expect(toml.toLowerCase()).not.toContain("r2_buckets");
    expect(toml.toLowerCase()).not.toContain("d1_databases");
    expect(toml.toLowerCase()).not.toContain("queues");
    expect(toml.toLowerCase()).not.toContain("services");
  });

  it("18 keeps the paid route disabled in the production entry", () => {
    expect(mainnetEntry).toContain('code: "NOT_ENABLED"');
    expect(mainnetEntry).not.toContain("MAINNET_SELLER_ADDRESS");
  });

  it("19 keeps the PayAI adapter absent from the production entry", () => {
    expect(mainnetEntry).not.toContain("createProofFacilitatorCandidateHttpClient");
    expect(mainnetEntry).not.toContain("HTTPFacilitatorClient");
  });

  it("20 keeps production facilitator selected false", () => {
    expect(proofCandidate).toContain("MAINNET_PRODUCTION_FACILITATOR_SELECTED = false");
    expect(MAINNET_PRODUCTION_FACILITATOR_SELECTED).toBe(false);
  });

  it("21 keeps production seller activated false", () => {
    expect(proofCandidate).toContain("MAINNET_PRODUCTION_SELLER_ACTIVATED = false");
    expect(MAINNET_PRODUCTION_SELLER_ACTIVATED).toBe(false);
  });

  it("22 keeps payment ready false", () => {
    expect(proofCandidate).toContain("MAINNET_PAYMENT_READY = false");
    expect(MAINNET_PAYMENT_READY).toBe(false);
    expect(MAINNET_PAID_ROUTE_ENABLED).toBe(false);
  });

  it("23 documents binding without claiming production seller configured", () => {
    expect(doc).toMatch(/Never commit the address/i);
    expect(doc).toMatch(/outside Git/i);
    expect(doc).toMatch(/does not consume/i);
    expect(doc).not.toMatch(/production seller configured in tracked source/i);
    expect(doc).not.toMatch(/payment ready.*true/i);
  });
});
