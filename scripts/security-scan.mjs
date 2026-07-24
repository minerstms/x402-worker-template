#!/usr/bin/env node
import { spawnSync } from "node:child_process";
import { existsSync, readFileSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";
import {
  MAX_BLOB_BYTES,
  SECRET_CATEGORIES,
  applyAllowlist,
  classifyHistory,
  formatFinding,
  isLikelyBinary,
  loadAllowlist,
  scanTextContent,
  validateAllowlistEntries,
} from "./lib/security-scan-core.mjs";

const repoRoot = process.cwd();
const modeArg = process.argv.find((arg) => ["--tracked", "--history", "--all"].includes(arg));
const mode = modeArg?.slice(2) ?? "tracked";

function git(args, input) {
  const result = spawnSync("git", args, {
    cwd: repoRoot,
    encoding: "utf8",
    input,
    maxBuffer: 64 * 1024 * 1024,
  });
  if (result.status !== 0) {
    throw new Error(result.stderr || result.stdout || `git ${args.join(" ")} failed`);
  }
  return result.stdout;
}

function listTrackedFiles() {
  if (!existsSync(join(repoRoot, ".git"))) {
    const excluded = new Set([
      "node_modules",
      "dist",
      "dist-mainnet",
      "dist-mainnet-mock-harness",
      "coverage",
      ".wrangler",
    ]);
    const files = [];
    function walk(relativeDir = "") {
      const absoluteDir = relativeDir ? join(repoRoot, relativeDir) : repoRoot;
      for (const entry of readdirSync(absoluteDir)) {
        if (excluded.has(entry)) continue;
        const relativePath = relativeDir ? `${relativeDir}/${entry}` : entry;
        const absolutePath = join(repoRoot, relativePath);
        const stat = statSync(absolutePath);
        if (stat.isDirectory()) {
          walk(relativePath);
          continue;
        }
        files.push(relativePath.replace(/\\/g, "/"));
      }
    }
    walk();
    return files;
  }

  const output = git(["ls-files", "-z"]);
  return output.split("\0").filter(Boolean);
}

function scanTracked(allowlist) {
  const findings = [];
  for (const relativePath of listTrackedFiles()) {
    const content = readFileSync(join(repoRoot, relativePath), "utf8");
    findings.push(
      ...scanTextContent(content, {
        path: relativePath,
        scope: "tracked",
      }),
    );
  }
  const { approved, unapproved, unused } = applyAllowlist(findings, allowlist, "tracked");
  return { findings, approved, unapproved, unused, stats: { scannedFiles: listTrackedFiles().length } };
}

function parseRevListObjects() {
  const output = git(["rev-list", "--objects", "--all"]);
  const entries = [];
  for (const line of output.split("\n")) {
    if (!line) continue;
    const space = line.indexOf(" ");
    if (space === -1) continue;
    entries.push({
      object: line.slice(0, space),
      path: line.slice(space + 1),
    });
  }
  return entries;
}

function scanHistory(allowlist) {
  const entries = parseRevListObjects();
  const byObject = new Map();
  for (const entry of entries) {
    if (!byObject.has(entry.object)) {
      byObject.set(entry.object, []);
    }
    byObject.get(entry.object).push(entry.path);
  }

  const uniqueObjects = [...byObject.keys()];
  const batchCheckInput = uniqueObjects.join("\n") + "\n";
  const batchCheckOutput = git(["cat-file", "--batch-check"], batchCheckInput);
  const blobObjects = [];
  let binarySkipped = 0;
  let oversizedSkipped = 0;

  for (const line of batchCheckOutput.split("\n")) {
    if (!line) continue;
    const [oid, type, sizeText] = line.split(" ");
    if (type !== "blob") continue;
    const size = Number(sizeText);
    if (!Number.isFinite(size)) continue;
    if (size > MAX_BLOB_BYTES) {
      oversizedSkipped += 1;
      continue;
    }
    blobObjects.push({ object: oid, size, paths: byObject.get(oid) ?? ["<unknown>"] });
  }

  const findings = [];
  if (blobObjects.length > 0) {
    const batchInput =
      blobObjects.map((entry) => entry.object).join("\n") + "\n";
    const batch = spawnSync("git", ["cat-file", "--batch"], {
      cwd: repoRoot,
      input: batchInput,
      maxBuffer: 128 * 1024 * 1024,
    });
    if (batch.status !== 0) {
      throw new Error(batch.stderr?.toString() || "git cat-file --batch failed");
    }

    let offset = 0;
    const stdout = batch.stdout;
    for (const entry of blobObjects) {
      const headerEnd = stdout.indexOf("\n", offset);
      const header = stdout.slice(offset, headerEnd).toString("utf8");
      const [, , sizeText] = header.split(" ");
      const size = Number(sizeText);
      const start = headerEnd + 1;
      const end = start + size;
      const buffer = stdout.subarray(start, end);
      offset = end + 1;

      if (isLikelyBinary(buffer)) {
        binarySkipped += 1;
        continue;
      }

      const content = buffer.toString("utf8");
      for (const path of entry.paths) {
        findings.push(
          ...scanTextContent(content, {
            path,
            object: entry.object,
            scope: "history",
          }),
        );
      }
    }
  }

  const { approved, unapproved, unused } = applyAllowlist(findings, allowlist, "history");
  return {
    findings,
    approved,
    unapproved,
    unused,
    stats: {
      uniqueObjects: uniqueObjects.length,
      scannedBlobs: blobObjects.length - binarySkipped,
      binarySkipped,
      oversizedSkipped,
      deduplicatedObjects: uniqueObjects.length,
    },
  };
}

function main() {
  const allowlist = loadAllowlist(repoRoot);
  validateAllowlistEntries(allowlist);

  let trackedResult = null;
  let historyResult = null;

  if (mode === "tracked" || mode === "all") {
    trackedResult = scanTracked(allowlist);
    console.log(`Tracked scan: ${trackedResult.stats.scannedFiles} files`);
    if (trackedResult.approved.length > 0) {
      console.log(`Allowlisted findings: ${trackedResult.approved.length}`);
    }
    if (trackedResult.unused.length > 0) {
      console.error("Unused tracked allowlist entries:");
      for (const entry of trackedResult.unused) {
        console.error(`- ${entry.path} ${entry.category} ${entry.sha256}`);
      }
      process.exit(1);
    }
    if (trackedResult.unapproved.length > 0) {
      console.error("Unapproved tracked findings:");
      for (const finding of trackedResult.unapproved) {
        console.error(formatFinding(finding));
      }
      process.exit(1);
    }
    console.log("Tracked security scan: PASS");
  }

  if (mode === "history" || mode === "all") {
    historyResult = scanHistory(allowlist);
    console.log(
      `History scan: objects=${historyResult.stats.uniqueObjects} blobs=${historyResult.stats.scannedBlobs} binarySkipped=${historyResult.stats.binarySkipped} oversizedSkipped=${historyResult.stats.oversizedSkipped}`,
    );
    if (historyResult.unused.length > 0) {
      console.error("Unused history allowlist entries:");
      for (const entry of historyResult.unused) {
        console.error(`- ${entry.path} ${entry.category} ${entry.sha256}`);
      }
      process.exit(1);
    }

    const classification = classifyHistory(historyResult.unapproved);
    console.log(`HISTORY CLASSIFICATION: ${classification}`);

    if (historyResult.unapproved.length > 0) {
      console.error("Unapproved historical findings:");
      for (const finding of historyResult.unapproved.slice(0, 20)) {
        console.error(formatFinding(finding));
      }
      if (historyResult.unapproved.length > 20) {
        console.error(`…and ${historyResult.unapproved.length - 20} more`);
      }
    }

    if (
      historyResult.unapproved.some((finding) =>
        SECRET_CATEGORIES.has(finding.category),
      )
    ) {
      console.error("STRICT STOP: secret material detected in history");
      process.exit(1);
    }

    if (classification !== "HISTORY CLEAN") {
      console.error("HISTORY REWRITE REQUIRED BEFORE PUBLIC PUSH");
      process.exit(1);
    }
    console.log("History security scan: PASS");
  }
}

main();
