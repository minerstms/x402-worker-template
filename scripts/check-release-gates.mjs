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

  if (!mainnetEntry.includes('code: "NOT_ENABLED"')) {
    console.error("Production mainnet paid route is not disabled.");
    process.exit(1);
  }

  if (mainnetToml.match(/facilitator.*payai|FACILITATOR_URL.*payai/i)) {
    console.error("Production facilitator appears configured.");
    process.exit(1);
  }

  if (mockHarness.includes("index.mainnet.ts")) {
    console.error("Mock harness must remain isolated from production mainnet entry.");
    process.exit(1);
  }

  console.log("Release gate check: PASS (production mainnet disabled, no production facilitator configured)");
}

main();
