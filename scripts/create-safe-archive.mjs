#!/usr/bin/env node
import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const repoRoot = process.cwd();
const DANGEROUS_UNTRACKED = [
  /^\.env$/i,
  /^\.dev\.vars$/i,
  /^\.npmrc$/i,
  /^.*\.(key|pem|p12|pfx|jks|keystore|wallet|seed)$/i,
  /^payai-supported\.json$/i,
];

function run(command, args, options = {}) {
  const result = spawnSync(command, args, {
    cwd: repoRoot,
    stdio: "inherit",
    ...options,
  });
  if (result.status !== 0) {
    throw new Error(`${command} ${args.join(" ")} failed`);
  }
}

function git(args) {
  const result = spawnSync("git", args, {
    cwd: repoRoot,
    encoding: "utf8",
  });
  if (result.status !== 0) {
    throw new Error(result.stderr || result.stdout || `git ${args.join(" ")} failed`);
  }
  return result.stdout.trim();
}

function assertCleanTree() {
  if (git(["status", "--porcelain"])) {
    throw new Error("Working tree must be clean before creating a release archive");
  }
}

function assertNoDangerousUntracked() {
  const untracked = git(["ls-files", "--others", "--exclude-standard"]).split("\n").filter(Boolean);
  for (const file of untracked) {
    if (DANGEROUS_UNTRACKED.some((pattern) => pattern.test(file))) {
      throw new Error(`Refusing to create archive with dangerous untracked file: ${file}`);
    }
  }
}

function sha256File(path) {
  const hash = createHash("sha256");
  hash.update(readFileSync(path));
  return hash.digest("hex");
}

function main() {
  assertCleanTree();
  assertNoDangerousUntracked();

  run("node", ["scripts/security-scan.mjs", "--tracked"]);
  run("node", ["scripts/check-dependency-pins.mjs"]);
  run("node", ["scripts/check-public-docs.mjs"]);
  run("node", ["scripts/check-release-gates.mjs"]);

  const head = git(["rev-parse", "HEAD"]);
  const short = git(["rev-parse", "--short", "HEAD"]);
  const outputDir = join(tmpdir(), "x402-worker-template-release-archives");
  mkdirSync(outputDir, { recursive: true });
  const archivePath = join(outputDir, `x402-worker-template-${short}.zip`);
  if (existsSync(archivePath)) {
    rmSync(archivePath);
  }

  try {
    run("git", ["archive", "--format=zip", "-o", archivePath, head]);
    const checksum = sha256File(archivePath);
    console.log(`Archive path: ${archivePath}`);
    console.log(`Archive SHA-256: ${checksum}`);
    console.log(`Source commit: ${head} (${short})`);
    console.log("Archive excludes .git, node_modules, local env files, Wrangler state, and untracked files by design.");
  } catch (error) {
    if (existsSync(archivePath)) {
      rmSync(archivePath);
    }
    throw error;
  }
}

try {
  main();
} catch (error) {
  console.error(error instanceof Error ? error.message : String(error));
  process.exit(1);
}
