#!/usr/bin/env node
import { spawnSync } from "node:child_process";

const steps = [
  { label: "Tracked security scan", command: ["node", "scripts/security-scan.mjs", "--tracked"] },
  { label: "History security scan", command: ["node", "scripts/security-scan.mjs", "--history"] },
  { label: "Dependency pin check", command: ["node", "scripts/check-dependency-pins.mjs"] },
  { label: "Runtime toolchain check", command: ["node", "scripts/check-runtime-toolchain.mjs"] },
  { label: "Documentation consistency check", command: ["node", "scripts/check-public-docs.mjs"] },
  { label: "License check", command: ["node", "scripts/check-license.mjs"] },
  { label: "GitHub action pin check", command: ["node", "scripts/check-github-action-pins.mjs"] },
  { label: "Canonical repository check", command: ["node", "scripts/check-canonical-repo.mjs"] },
  { label: "Unit and integration tests", command: ["npm", "test"] },
  { label: "Typecheck", command: ["npm", "run", "typecheck"] },
  { label: "Mainnet typecheck", command: ["npm", "run", "typecheck:mainnet"] },
  { label: "Build testnet bundle", command: ["npm", "run", "build"] },
  { label: "Build mainnet bundle", command: ["npm", "run", "build:mainnet"] },
  { label: "Build mainnet mock browser bundle", command: ["npm", "run", "build:mainnet:mock-browser"] },
  { label: "Build mainnet mock harness bundle", command: ["npm", "run", "build:mainnet:mock-harness:test"] },
  {
    label: "Wrangler dry-run (testnet)",
    command: ["npx", "wrangler", "deploy", "--dry-run"],
  },
  {
    label: "Wrangler dry-run (mainnet)",
    command: ["npx", "wrangler", "deploy", "--dry-run", "-c", "wrangler.mainnet.toml"],
  },
  {
    label: "Wrangler dry-run (mainnet mock harness)",
    command: ["npx", "wrangler", "deploy", "--dry-run", "-c", "wrangler.mainnet-mock-harness.toml"],
  },
  { label: "Release gate check", command: ["node", "scripts/check-release-gates.mjs"] },
  { label: "Git diff whitespace check", command: ["git", "diff", "--check"] },
];

function runStep(step) {
  console.log(`\n==> ${step.label}`);
  const result = spawnSync(step.command[0], step.command.slice(1), {
    cwd: process.cwd(),
    stdio: "inherit",
    shell: process.platform === "win32",
  });
  if (result.status !== 0) {
    console.error(`Release check failed at step: ${step.label}`);
    process.exit(result.status ?? 1);
  }
}

for (const step of steps) {
  runStep(step);
}

console.log("\nRelease check: PASS (automation gates)");
console.log("PUBLIC RELEASE STATUS: INITIAL PUSH AUTHORIZED");
console.log("- Canonical repository: https://github.com/minerstms/x402-worker-template");
console.log("- LICENSE: Apache-2.0");
console.log("- HISTORY CLASSIFICATION: HISTORY CLEAN");
console.log("- Production mainnet route: disabled");
console.log("- Production facilitator: not selected");
console.log("- Production seller: not configured in tracked source");
console.log("- Real Base-mainnet payment: not completed (mocks only)");
