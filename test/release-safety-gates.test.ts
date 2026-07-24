import { execSync, spawnSync } from "node:child_process";
import { existsSync, mkdtempSync, mkdirSync, readFileSync, writeFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import {
  applyAllowlist,
  classifyHistory,
  formatFinding,
  redactPreview,
  scanTextContent,
  sha256,
  validateAllowlistEntries,
} from "../scripts/lib/security-scan-core.mjs";

const ROOT = join(import.meta.dirname, "..");

function readRepoFile(relativePath: string): string {
  return readFileSync(join(ROOT, relativePath), "utf8");
}

describe("security scanner core", () => {
  it("catches a private-key header", () => {
    const findings = scanTextContent("-----BEGIN PRIVATE KEY-----\nabc", {
      path: "fixture.txt",
      scope: "tracked",
    });
    expect(findings.some((f) => f.category === "private-key-material")).toBe(true);
  });

  it("catches credential-bearing URLs", () => {
    const findings = scanTextContent("fetch('https://user:secret@host.example.net/path')", {
      path: "fixture.txt",
      scope: "tracked",
    });
    expect(findings.some((f) => f.category === "credential-url")).toBe(true);
  });

  it("catches nonblank private-key environment assignments", () => {
    const findings = scanTextContent("EVM_PRIVATE_KEY=0x1111111111111111111111111111111111111111111111111111111111111111", {
      path: ".env.buyer",
      scope: "tracked",
    });
    expect(findings.some((f) => f.category === "private-key-env")).toBe(true);
  });

  it("does not classify a transaction hash alone as a private key", () => {
    const findings = scanTextContent(
      "transaction hash requires 0xaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
      { path: "fixture.txt", scope: "tracked" },
    );
    expect(findings.some((f) => f.category === "private-key-env")).toBe(false);
  });

  it("never prints the full matched secret in previews", () => {
    const secret = "ghp_1234567890123456789012345678901234567890";
    const preview = redactPreview(secret, "github-token");
    expect(preview).not.toBe(secret);
    expect(preview).toContain("…");
    expect(
      formatFinding({
        category: "github-token",
        path: "fixture.txt",
        matchSha256: sha256(secret),
        preview,
      }),
    ).not.toContain(secret);
  });

  it("accepts hashed allowlist entries only for exact matches", () => {
    const match = "fixture-secret-value";
    const allowlist = [
      {
        path: "fixture.txt",
        category: "api-key-assignment",
        sha256: sha256(`api_key=${match}`),
        reason: "test fixture",
        scope: "tracked",
      },
    ];
    validateAllowlistEntries(allowlist);
    const findings = scanTextContent(`api_key=${match}`, {
      path: "fixture.txt",
      scope: "tracked",
    });
    const approved = applyAllowlist(findings, allowlist, "tracked");
    expect(approved.unapproved).toHaveLength(0);
    expect(approved.unused).toHaveLength(0);
  });

  it("rejects changed allowlisted matches", () => {
    const allowlist = [
      {
        path: "fixture.txt",
        category: "api-key-assignment",
        sha256: sha256("api_key=original-value"),
        reason: "test fixture",
        scope: "tracked",
      },
    ];
    const findings = scanTextContent("api_key=changed-value", {
      path: "fixture.txt",
      scope: "tracked",
    });
    const result = applyAllowlist(findings, allowlist, "tracked");
    expect(result.unapproved.length).toBeGreaterThan(0);
    expect(result.unused.length).toBe(1);
  });

  it("fails validation for unused allowlist entries", () => {
    const findings = scanTextContent("clean content", {
      path: "fixture.txt",
      scope: "tracked",
    });
    const allowlist = [
      {
        path: "fixture.txt",
        category: "api-key-assignment",
        sha256: sha256("unused"),
        reason: "unused",
        scope: "tracked",
      },
    ];
    const result = applyAllowlist(findings, allowlist, "tracked");
    expect(result.unused).toHaveLength(1);
  });

  it("classifies privacy-only history as rewrite required", () => {
    const classification = classifyHistory([
      {
        category: "workers-hostname",
        path: "docs/example.md",
        matchSha256: sha256("host"),
        preview: "x402….dev",
      },
    ]);
    expect(classification).toBe(
      "HISTORY CONTAINS PRIVACY-ONLY FINDINGS — REWRITE REQUIRED",
    );
  });
});

describe("security scanner scripts", () => {
  it("uses Git object plumbing for history mode", () => {
    const source = readRepoFile("scripts/security-scan.mjs");
    expect(source).toContain('["rev-list", "--objects", "--all"]');
    expect(source).toContain('["cat-file", "--batch-check"]');
    expect(source).toContain('["cat-file", "--batch"]');
  });

  it("deduplicates history blobs by object id", () => {
    const source = readRepoFile("scripts/security-scan.mjs");
    expect(source).toContain("byObject");
    expect(source).toContain("uniqueObjects");
  });

  it("does not write historical blob contents to disk", () => {
    const source = readRepoFile("scripts/security-scan.mjs");
    expect(source).not.toMatch(/writeFileSync\([^)]*content/);
    expect(source).toContain("buffer.toString(\"utf8\")");
  });

  it("reports HISTORY CLEAN from real history scan", () => {
    if (!existsSync(join(ROOT, ".git"))) {
      return;
    }
    const result = spawnSync("node", ["scripts/security-scan.mjs", "--history"], {
      cwd: ROOT,
      encoding: "utf8",
    });
    expect(result.stdout + result.stderr).toContain("HISTORY CLASSIFICATION: HISTORY CLEAN");
    expect(result.stdout + result.stderr).toContain("History security scan: PASS");
    expect(result.stdout + result.stderr).not.toContain(
      "HISTORY REWRITE REQUIRED BEFORE PUBLIC PUSH",
    );
    expect(result.status).toBe(0);
  });
});

describe("documentation consistency gate", () => {
  it("catches real Workers hostnames", () => {
    const dir = mkdtempSync(join(tmpdir(), "docs-gate-"));
    const file = join(dir, "sample.md");
    writeFileSync(
      file,
      "Visit https://x402-worker-template-testnet.exampleperson.workers.dev/pay\n",
    );
    const script = readRepoFile("scripts/check-public-docs.mjs");
    expect(script).toContain("workers-hostname");
    rmSync(dir, { recursive: true, force: true });
  });

  it("catches local Windows paths", () => {
    const script = readRepoFile("scripts/check-public-docs.mjs");
    expect(script).toContain("absolute-user-path");
    expect(script).toContain("Users");
  });

  it("catches false production-ready claims", () => {
    const script = readRepoFile("scripts/check-public-docs.mjs");
    expect(script).toContain("production-ready-claim");
  });

  it("allows negated approved status language", () => {
    const script = readRepoFile("scripts/check-public-docs.mjs");
    expect(script).toContain(String.raw`\bnot\b`);
    const result = spawnSync("node", ["scripts/check-public-docs.mjs"], {
      cwd: ROOT,
      encoding: "utf8",
    });
    expect(result.status).toBe(0);
  });
});

describe("dependency pin gate", () => {
  it("fails dependency ranges", () => {
    const dir = mkdtempSync(join(tmpdir(), "deps-gate-"));
    writeFileSync(
      join(dir, "package.json"),
      JSON.stringify(
        {
          private: true,
          packageManager: "npm@11.13.0",
          engines: { node: "22.20.1" },
          dependencies: { hono: "^4.12.31" },
        },
        null,
        2,
      ),
    );
    writeFileSync(
      join(dir, "package-lock.json"),
      JSON.stringify(
        {
          lockfileVersion: 3,
          packages: {
            "": { dependencies: { hono: "^4.12.31" } },
          },
        },
        null,
        2,
      ),
    );
    const result = spawnSync("node", ["scripts/check-dependency-pins.mjs"], {
      cwd: dir,
      encoding: "utf8",
    });
    expect(result.status).toBe(1);
    rmSync(dir, { recursive: true, force: true });
  });

  it("passes exact dependency pins in the repository", () => {
    const result = spawnSync("node", ["scripts/check-dependency-pins.mjs"], {
      cwd: ROOT,
      encoding: "utf8",
    });
    expect(result.status).toBe(0);
  });

  it("requires packageManager and matching lockfile metadata", () => {
    const pkg = JSON.parse(readRepoFile("package.json"));
    const lock = JSON.parse(readRepoFile("package-lock.json"));
    expect(pkg.packageManager).toMatch(/^npm@\d/);
    expect(lock.packages[""].dependencies["@x402/core"]).toBe("2.19.0");
  });

  it("fails direct transitive-only runtime imports", () => {
    const dir = mkdtempSync(join(tmpdir(), "import-gate-"));
    writeFileSync(
      join(dir, "package.json"),
      JSON.stringify(
        {
          private: true,
          packageManager: "npm@11.13.0",
          engines: { node: "22.20.1" },
          dependencies: { hono: "4.12.31" },
        },
        null,
        2,
      ),
    );
    writeFileSync(
      join(dir, "package-lock.json"),
      JSON.stringify({ lockfileVersion: 3, packages: { "": { dependencies: { hono: "4.12.31" } } } }),
    );
    mkdirSync(join(dir, "src"), { recursive: true });
    writeFileSync(join(dir, "src", "index.ts"), 'import "undici";\n');
    const result = spawnSync("node", ["scripts/check-dependency-pins.mjs"], {
      cwd: dir,
      encoding: "utf8",
      shell: process.platform === "win32",
    });
    expect(result.status).toBe(1);
    rmSync(dir, { recursive: true, force: true });
  });
});

describe("CI and release archive hardening", () => {
  it("uses read-only CI permissions", () => {
    const ci = readRepoFile(".github/workflows/ci.yml");
    expect(ci).toContain("permissions:");
    expect(ci).toContain("contents: read");
    expect(ci).not.toContain("contents: write");
  });

  it("runs history scanning in CI", () => {
    const ci = readRepoFile(".github/workflows/ci.yml");
    expect(ci).toContain("npm run security:scan:history");
  });

  it("pins GitHub Actions to full commit SHAs", () => {
    const ci = readRepoFile(".github/workflows/ci.yml");
    expect(ci).toMatch(/uses: actions\/checkout@[0-9a-f]{40}/);
    expect(ci).toMatch(/uses: actions\/setup-node@[0-9a-f]{40}/);
    expect(ci).not.toMatch(/uses: actions\/checkout@v/);
  });

  it("runs GitHub action pin check in CI", () => {
    const ci = readRepoFile(".github/workflows/ci.yml");
    expect(ci).toContain("npm run check:actions");
  });

  it("runs GitHub action pin check in release check", () => {
    const script = readRepoFile("scripts/release-check.mjs");
    expect(script).toContain("scripts/check-github-action-pins.mjs");
  });

  it("runs GitHub action pin check in the manual release workflow", () => {
    const workflow = readRepoFile(".github/workflows/release-archive.yml");
    expect(workflow).toContain("npm run check:actions");
  });

  it("runs GitHub action pin check during archive verification", () => {
    const script = readRepoFile("scripts/verify-release-archive.ts");
    expect(script).toContain("npm run check:actions");
  });

  it("contains no deploy or payment commands in CI", () => {
    const ci = readRepoFile(".github/workflows/ci.yml");
    expect(ci).not.toMatch(/\bwrangler deploy\b(?! --dry-run)/);
    expect(ci).not.toContain("npm run buy");
    expect(ci).not.toContain("buyer:diagnose");
  });

  it("creates release archives with git archive", () => {
    const script = readRepoFile("scripts/create-safe-archive.mjs");
    expect(script).toContain('["archive", "--format=zip"');
    expect(script).toContain("createHash(\"sha256\")");
  });

  it("runs history scanning in release check", () => {
    const script = readRepoFile("scripts/release-check.mjs");
    expect(script).toContain('"--history"');
    expect(script).not.toContain("HISTORY REWRITE REQUIRED BEFORE PUBLIC PUSH");
  });

  it("runs history scanning in the manual release workflow", () => {
    const workflow = readRepoFile(".github/workflows/release-archive.yml");
    expect(workflow).toContain("npm run security:scan:history");
    expect(workflow).not.toContain("HISTORY REWRITE REQUIRED BEFORE PUBLIC PUSH");
  });

  it("refuses a dirty working tree for release archives", () => {
    const script = readRepoFile("scripts/create-safe-archive.mjs");
    expect(script).toContain('"status", "--porcelain"');
  });

  it("refuses dangerous untracked files before archiving", () => {
    const script = readRepoFile("scripts/create-safe-archive.mjs");
    expect(script).toContain('"ls-files", "--others", "--exclude-standard"');
    expect(script).toContain("DANGEROUS_UNTRACKED");
  });
});

const ACTION_PINS_MANIFEST = readRepoFile(".github/action-pins.json");
const CHECKOUT_SHA = "11bd71901bbe5b1630ceea73d27597364c9af683";
const SETUP_NODE_SHA = "49933ea5288caeca8642d1e84afbd3f7d6820020";

function runActionPinCheck(cwd: string) {
  return spawnSync("node", [join(ROOT, "scripts/check-github-action-pins.mjs")], {
    cwd,
    encoding: "utf8",
  });
}

function buildValidPinWorkflow(extraSteps = ""): string {
  return `name: CI
on: push
jobs:
  verify:
    runs-on: ubuntu-latest
    steps:
      - name: Checkout
        uses: actions/checkout@${CHECKOUT_SHA} # v4.2.2
      - name: Setup Node.js
        uses: actions/setup-node@${SETUP_NODE_SHA} # v4.4.0
${extraSteps}`;
}

function scaffoldPinCheckDir(workflowYaml: string, manifest = ACTION_PINS_MANIFEST): string {
  const dir = mkdtempSync(join(tmpdir(), "action-pins-"));
  mkdirSync(join(dir, ".github", "workflows"), { recursive: true });
  writeFileSync(join(dir, ".github", "action-pins.json"), manifest);
  writeFileSync(join(dir, ".github", "workflows", "ci.yml"), workflowYaml);
  return dir;
}

describe("GitHub action pin consistency", () => {
  it("passes on the repository root", () => {
    const result = runActionPinCheck(ROOT);
    expect(result.status).toBe(0);
    expect(result.stdout).toContain("GitHub action pin check: PASS");
    expect(result.stdout).toContain(`actions/checkout@${CHECKOUT_SHA}`);
    expect(result.stdout).toContain(`actions/setup-node@${SETUP_NODE_SHA}`);
  });

  it("passes when checkout and setup-node SHAs match the manifest", () => {
    const dir = scaffoldPinCheckDir(buildValidPinWorkflow());
    const result = runActionPinCheck(dir);
    expect(result.status).toBe(0);
    rmSync(dir, { recursive: true, force: true });
  });

  it("fails when checkout SHA differs by one character", () => {
    const mutated = `${CHECKOUT_SHA.slice(0, -1)}4`;
    const dir = scaffoldPinCheckDir(buildValidPinWorkflow().replace(CHECKOUT_SHA, mutated));
    const result = runActionPinCheck(dir);
    expect(result.status).toBe(1);
    expect(result.stderr).toContain("SHA mismatch");
    rmSync(dir, { recursive: true, force: true });
  });

  it("fails when setup-node SHA differs by one character", () => {
    const mutated = `${SETUP_NODE_SHA.slice(0, -1)}1`;
    const dir = scaffoldPinCheckDir(buildValidPinWorkflow().replace(SETUP_NODE_SHA, mutated));
    const result = runActionPinCheck(dir);
    expect(result.status).toBe(1);
    expect(result.stderr).toContain("SHA mismatch");
    rmSync(dir, { recursive: true, force: true });
  });

  it("fails on short SHAs", () => {
    const shortSha = CHECKOUT_SHA.slice(0, 7);
    const dir = scaffoldPinCheckDir(buildValidPinWorkflow().replace(CHECKOUT_SHA, shortSha));
    const result = runActionPinCheck(dir);
    expect(result.status).toBe(1);
    expect(result.stderr).toMatch(/invalid SHA length|non-SHA pin/);
    rmSync(dir, { recursive: true, force: true });
  });

  it("fails on mutable tag pins", () => {
    const dir = scaffoldPinCheckDir(buildValidPinWorkflow().replace(CHECKOUT_SHA, "v4"));
    const result = runActionPinCheck(dir);
    expect(result.status).toBe(1);
    expect(result.stderr).toContain("mutable tag pin");
    rmSync(dir, { recursive: true, force: true });
  });

  it("fails when the tag comment is missing", () => {
    const workflow = buildValidPinWorkflow().replace(` # v4.2.2`, "");
    const dir = scaffoldPinCheckDir(workflow);
    const result = runActionPinCheck(dir);
    expect(result.status).toBe(1);
    expect(result.stderr).toContain("tag comment mismatch");
    rmSync(dir, { recursive: true, force: true });
  });

  it("fails when the tag comment is wrong", () => {
    const workflow = buildValidPinWorkflow().replace("# v4.2.2", "# v4.2.1");
    const dir = scaffoldPinCheckDir(workflow);
    const result = runActionPinCheck(dir);
    expect(result.status).toBe(1);
    expect(result.stderr).toContain("tag comment mismatch");
    rmSync(dir, { recursive: true, force: true });
  });

  it("fails when the manifest and workflow disagree", () => {
    const manifest = JSON.stringify(
      {
        "actions/checkout": { tag: "v4.2.2", sha: CHECKOUT_SHA },
        "actions/setup-node": { tag: "v4.4.0", sha: "0000000000000000000000000000000000000000" },
      },
      null,
      2,
    );
    const dir = scaffoldPinCheckDir(buildValidPinWorkflow(), manifest);
    const result = runActionPinCheck(dir);
    expect(result.status).toBe(1);
    expect(result.stderr).toContain("SHA mismatch");
    rmSync(dir, { recursive: true, force: true });
  });

  it("fails on unreviewed external actions", () => {
    const workflow = `${buildValidPinWorkflow()}
      - name: Cache
        uses: actions/cache@deadbeefdeadbeefdeadbeefdeadbeefdeadbeef # v4.0.0`;
    const dir = scaffoldPinCheckDir(workflow);
    const result = runActionPinCheck(dir);
    expect(result.status).toBe(1);
    expect(result.stderr).toContain("unreviewed external action actions/cache");
    rmSync(dir, { recursive: true, force: true });
  });

  it("permits local action references", () => {
    const workflow = `${buildValidPinWorkflow()}
      - name: Local action
        uses: ./.github/actions/local`;
    const dir = scaffoldPinCheckDir(workflow);
    const result = runActionPinCheck(dir);
    expect(result.status).toBe(0);
    rmSync(dir, { recursive: true, force: true });
  });
});

describe("license and production release gates", () => {
  it("declares Apache-2.0 in package metadata", () => {
    const pkg = JSON.parse(readRepoFile("package.json"));
    expect(pkg.license).toBe("Apache-2.0");
  });

  it("includes the canonical Apache-2.0 LICENSE file", () => {
    const license = readRepoFile("LICENSE");
    expect(license).toContain("Apache License");
    expect(license).toContain("Version 2.0, January 2004");
    expect(license).toContain("END OF TERMS AND CONDITIONS");
  });

  it("passes the license gate", () => {
    const result = spawnSync("node", ["scripts/check-license.mjs"], {
      cwd: ROOT,
      encoding: "utf8",
    });
    expect(result.status).toBe(0);
    expect(result.stdout).toContain("License check: PASS (Apache-2.0)");
    expect(result.stdout).toContain("No project-level NOTICE file is currently required.");
  });

  it("documents sanitized history in README", () => {
    const readme = readRepoFile("README.md");
    expect(readme).toContain("HISTORY CLEAN");
    expect(readme).not.toContain("HISTORY CONTAINS PRIVACY-ONLY FINDINGS");
    expect(readme).not.toContain("History rewrite is required");
  });

  it("documents Apache-2.0 licensing in README", () => {
    const readme = readRepoFile("README.md");
    expect(readme).toContain("Apache License 2.0");
    expect(readme).toContain("Apache-2.0");
    expect(readme).not.toContain("LICENSE DECISION REQUIRED BEFORE PUBLIC REUSE");
  });

  it("marks initial public push as authorized", () => {
    const releaseCheck = readRepoFile("scripts/release-check.mjs");
    expect(releaseCheck).toContain("INITIAL PUSH AUTHORIZED");
    expect(releaseCheck).toContain("minerstms/x402-worker-template");
    expect(releaseCheck).toContain("LICENSE: Apache-2.0");
    expect(releaseCheck).not.toContain("LICENSE DECISION REQUIRED BEFORE PUBLIC REUSE");
    expect(releaseCheck).not.toContain("HISTORY REWRITE REQUIRED BEFORE PUBLIC PUSH");
  });

  it("declares exact canonical package repository metadata", () => {
    const pkg = JSON.parse(readRepoFile("package.json"));
    expect(pkg.repository).toEqual({
      type: "git",
      url: "git+https://github.com/minerstms/x402-worker-template.git",
    });
    expect(pkg.homepage).toBe("https://github.com/minerstms/x402-worker-template#readme");
    expect(pkg.bugs).toEqual({
      url: "https://github.com/minerstms/x402-worker-template/issues",
    });
  });

  it("passes canonical repository metadata check in Git checkout", () => {
    const result = spawnSync("node", ["scripts/check-canonical-repo.mjs"], {
      cwd: ROOT,
      encoding: "utf8",
    });
    expect(result.status).toBe(0);
    expect(result.stdout).toContain("minerstms/x402-worker-template");
  });

  it("passes canonical repository metadata check without Git metadata", () => {
    const dir = mkdtempSync(join(tmpdir(), "canonical-archive-"));
    writeFileSync(join(dir, "package.json"), readRepoFile("package.json"));
    const result = spawnSync("node", [join(ROOT, "scripts/check-canonical-repo.mjs")], {
      cwd: dir,
      encoding: "utf8",
    });
    expect(result.status).toBe(0);
    expect(result.stdout).toContain("package metadata only");
    rmSync(dir, { recursive: true, force: true });
  });

  it("rejects a non-canonical origin remote", () => {
    const dir = mkdtempSync(join(tmpdir(), "canonical-origin-"));
    execSync("git init", { cwd: dir });
    execSync("git remote add origin https://github.com/example/other-repo.git", { cwd: dir });
    writeFileSync(join(dir, "package.json"), readRepoFile("package.json"));
    const result = spawnSync("node", [join(ROOT, "scripts/check-canonical-repo.mjs")], {
      cwd: dir,
      encoding: "utf8",
    });
    expect(result.status).toBe(1);
    expect(result.stderr).toContain("minerstms/x402-worker-template");
    rmSync(dir, { recursive: true, force: true });
  });

  it("documents canonical repository publication status in README", () => {
    const readme = readRepoFile("README.md");
    expect(readme).toContain("https://github.com/minerstms/x402-worker-template");
    expect(readme).toContain("PUBLIC REPOSITORY CREATED");
    expect(readme).toContain("INITIAL PUSH AUTHORIZED");
    expect(readme).not.toMatch(/has not been published/i);
    expect(readme).not.toMatch(/no git remote configured/i);
    expect(readme).toMatch(/production mainnet paid route remains disabled/i);
    expect(readme).toMatch(/no production facilitator is selected/i);
    expect(readme).toMatch(/no production seller is configured/i);
  });

  it("uses the neutral identity for every commit author and committer", () => {
    if (!existsSync(join(ROOT, ".git"))) {
      return;
    }
    const output = execSync('git log --format="%an <%ae> | %cn <%ce>" --all', {
      cwd: ROOT,
      encoding: "utf8",
    });
    for (const line of output.trim().split("\n")) {
      expect(line).toBe(
        "x402 Template Maintainer <x402-template@users.noreply.github.com> | x402 Template Maintainer <x402-template@users.noreply.github.com>",
      );
    }
  });

  it("preserves the sanitized rewrite content tree hash", () => {
    if (!existsSync(join(ROOT, ".git"))) {
      return;
    }
    const sanitizedCommit = execSync(
      'git log --format=%H -1 --grep="^Finalize sanitized public history$"',
      {
        cwd: ROOT,
        encoding: "utf8",
      },
    ).trim();
    expect(sanitizedCommit.length).toBeGreaterThan(0);
    const tree = execSync(`git rev-parse "${sanitizedCommit}^^{tree}"`, {
      cwd: ROOT,
      encoding: "utf8",
    }).trim();
    expect(tree).toBe("f313b612239dbd00fb92fd49ec44dc57107c88ab");
  });

  it("keeps the production mainnet route disabled", () => {
    const source = readRepoFile("src/index.mainnet.ts");
    expect(source).toContain('code: "NOT_ENABLED"');
  });

  it("does not configure a production facilitator", () => {
    const toml = readRepoFile("wrangler.mainnet.toml");
    expect(toml.toLowerCase()).not.toContain("payai");
  });
});

describe("tracked security scan on repository", () => {
  it("passes on the current tracked tree", () => {
    if (!existsSync(join(ROOT, ".git"))) {
      return;
    }
    execSync("node scripts/security-scan.mjs --tracked", {
      cwd: ROOT,
      stdio: "pipe",
    });
  });
});
