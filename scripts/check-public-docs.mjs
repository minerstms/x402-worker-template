#!/usr/bin/env node
import { spawnSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { join } from "node:path";

const repoRoot = process.cwd();
const DOC_SUFFIXES = [".md", ".json", ".toml", ".yml", ".yaml"];

const APPROVED_PATTERNS = [
  /base sepolia payment verified/i,
  /base mainnet flow validated with mocks only/i,
  /production mainnet route disabled/i,
  /production mainnet paid route remains disabled/i,
  /production facilitator not selected/i,
  /not production-ready/i,
  /not yet public-release ready/i,
];

const FAIL_PATTERNS = [
  {
    name: "absolute-user-path",
    regex: /(?:[A-Z]:\\Users\\|\/Users\/|\/home\/[^/\s]+\/)/,
  },
  {
    name: "personal-email",
    regex: /\b[A-Za-z0-9._%+-]+@(?!example\.com\b)[A-Za-z0-9.-]+\.[A-Za-z]{2,}\b/,
  },
  {
    name: "workers-hostname",
    regex: /\b[a-z0-9-]+(?:\.[a-z0-9-]+)*\.workers\.dev\b/i,
    allow(value) {
      const lower = value.toLowerCase();
      return (
        lower.includes("example-subdomain") ||
        lower.includes("other-subdomain") ||
        lower.includes("<workers-subdomain>") ||
        lower.includes("<testnet-worker-url>")
      );
    },
  },
  {
    name: "complete-address",
    regex: /\b0x[a-fA-F0-9]{40}\b/,
    allow(value, line) {
      if (/0x0{40}/.test(value)) return true;
      if (/0x000000000000000000000000000000000000dEaD/i.test(value)) return true;
      if (/dead placeholder|example seller|fake seller|X402_PAY_TO_ADDRESS/i.test(line)) {
        return true;
      }
      if (/Native Base USDC|USDbC|Asset \||payment-policy|canonical token/i.test(line)) {
        return true;
      }
      return false;
    },
  },
  {
    name: "complete-transaction-hash",
    regex: /\b0x[a-fA-F0-9]{64}\b/,
    allow(_value, line) {
      return /transaction hash|tx hash|64 hex|requires 0x/i.test(line);
    },
  },
  {
    name: "production-ready-claim",
    regex: /\b(?:production-ready|clone-ready for real-money production)\b/i,
    allow(_value, line) {
      return /\bnot\b/i.test(line);
    },
  },
  {
    name: "production-facilitator-selected",
    regex: /\b(?:production facilitator (?:was )?selected|selected production facilitator)\b/i,
    allow(_value, line) {
      return /\bnot\b/i.test(line);
    },
  },
  {
    name: "real-mainnet-payment",
    regex: /\b(?:real base[- ]mainnet payment occurred|verified real mainnet payment)\b/i,
  },
  {
    name: "mainnet-route-enabled",
    regex: /\b(?:mainnet paid route is enabled|production mainnet paid route enabled)\b/i,
    allow(_value, line) {
      return /\bnot\b|\bdisabled\b|\bremains disabled\b/i.test(line);
    },
  },
  {
    name: "redacted-deployment-reproduction",
    regex: /\b(?:reproduce the historical payment against|replay the historical payment against)\b/i,
    allow(_value, line) {
      return /\bcannot\b|\bdo not\b|\bnot\b/i.test(line);
    },
  },
];

function listTrackedFiles() {
  const output = spawnSync("git", ["ls-files"], {
    cwd: repoRoot,
    encoding: "utf8",
  }).stdout;
  return output
    .split(/\r?\n/)
    .filter(Boolean)
    .filter((file) => DOC_SUFFIXES.some((suffix) => file.endsWith(suffix)));
}

function scanFile(relativePath) {
  const content = readFileSync(join(repoRoot, relativePath), "utf8");
  const findings = [];
  const lines = content.split(/\r?\n/);

  for (let index = 0; index < lines.length; index += 1) {
    const line = lines[index];
    if (line.includes("PUBLIC-DOCS-EXCEPTION:")) {
      continue;
    }
    for (const rule of FAIL_PATTERNS) {
      rule.regex.lastIndex = 0;
      const match = rule.regex.exec(line);
      if (!match) continue;
      if (rule.allow?.(match[0], line, relativePath)) continue;
      if (APPROVED_PATTERNS.some((approved) => approved.test(line))) continue;
      findings.push({
        file: relativePath,
        line: index + 1,
        rule: rule.name,
        preview: line.trim().slice(0, 120),
      });
    }
  }

  return findings;
}

function main() {
  const findings = [];
  for (const file of listTrackedFiles()) {
    findings.push(...scanFile(file));
  }

  if (findings.length > 0) {
    console.error("Documentation consistency check failed:");
    for (const finding of findings) {
      console.error(
        `- ${finding.file}:${finding.line} [${finding.rule}] ${finding.preview}`,
      );
    }
    process.exit(1);
  }

  console.log("Documentation consistency check: PASS");
}

main();
