#!/usr/bin/env node
import { readFileSync } from "node:fs";
import { join } from "node:path";

const repoRoot = process.cwd();

function main() {
  const mainnetEntry = readFileSync(
    join(repoRoot, "src", "index.mainnet.ts"),
    "utf8",
  );
  const mockHarness = readFileSync(
    join(repoRoot, "src", "index.mainnet-mock-harness.ts"),
    "utf8",
  );
  const mainnetToml = readFileSync(join(repoRoot, "wrangler.mainnet.toml"), "utf8");
  const proofCandidate = readFileSync(
    join(repoRoot, "src", "mainnet", "proof-facilitator-candidate.mainnet.ts"),
    "utf8",
  );
  const proofHttp = readFileSync(
    join(repoRoot, "src", "mainnet", "proof-facilitator-http.mainnet.ts"),
    "utf8",
  );

  if (!mainnetEntry.includes('code: "NOT_ENABLED"')) {
    console.error("Production mainnet paid route is not disabled.");
    process.exit(1);
  }

  if (mainnetToml.match(/facilitator.*payai|FACILITATOR_URL.*payai/i)) {
    console.error("Production facilitator appears configured.");
    process.exit(1);
  }

  if (!proofCandidate.includes("MAINNET_PRODUCTION_FACILITATOR_SELECTED = false")) {
    console.error("Proof facilitator candidate must keep production selection false.");
    process.exit(1);
  }

  if (!proofCandidate.includes("MAINNET_PAID_ROUTE_ENABLED = false")) {
    console.error("Proof facilitator candidate must keep mainnet paid route disabled.");
    process.exit(1);
  }

  if (mainnetEntry.includes("HTTPFacilitatorClient")) {
    console.error("Production mainnet entry must not construct HTTPFacilitatorClient.");
    process.exit(1);
  }

  if (mainnetEntry.includes("createProofFacilitatorCandidateHttpClient")) {
    console.error("Production mainnet entry must not construct proof facilitator client.");
    process.exit(1);
  }

  if (proofHttp.match(/[^.]fetch\s*\(/)) {
    console.error("Proof facilitator HTTP must use injected fetch only.");
    process.exit(1);
  }

  if (proofHttp.includes("createAuthHeaders") || proofHttp.includes('"Authorization"')) {
    console.error("Proof facilitator adapter must remain unauthenticated.");
    process.exit(1);
  }

  if (mockHarness.includes("index.mainnet.ts")) {
    console.error("Mock harness must remain isolated from production mainnet entry.");
    process.exit(1);
  }

  console.log("Release gate check: PASS (production mainnet disabled, no production facilitator configured)");
}

main();
