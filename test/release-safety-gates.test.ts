import { execSync, spawnSync } from "node:child_process";
import { mkdtempSync, mkdirSync, readFileSync, writeFileSync, rmSync } from "node:fs";
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

  it("reports privacy-only rewrite requirement from real history scan", () => {
    const result = spawnSync("node", ["scripts/security-scan.mjs", "--history"], {
      cwd: ROOT,
      encoding: "utf8",
    });
    expect(result.stdout + result.stderr).toContain(
      "HISTORY CONTAINS PRIVACY-ONLY FINDINGS — REWRITE REQUIRED",
    );
    expect(result.stdout + result.stderr).toContain(
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

  it("pins GitHub Actions to full commit SHAs", () => {
    const ci = readRepoFile(".github/workflows/ci.yml");
    expect(ci).toMatch(/uses: actions\/checkout@[0-9a-f]{40}/);
    expect(ci).toMatch(/uses: actions\/setup-node@[0-9a-f]{40}/);
    expect(ci).not.toMatch(/uses: actions\/checkout@v/);
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

describe("license and production release gates", () => {
  it("keeps the license intentionally unselected", () => {
    const pkg = JSON.parse(readRepoFile("package.json"));
    expect(pkg.license).toBeUndefined();
    const result = spawnSync("node", ["scripts/check-license.mjs"], {
      cwd: ROOT,
      encoding: "utf8",
    });
    expect(result.status).toBe(0);
    expect(result.stderr).toContain("LICENSE DECISION REQUIRED BEFORE PUBLIC REUSE");
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
    execSync("node scripts/security-scan.mjs --tracked", {
      cwd: ROOT,
      stdio: "pipe",
    });
  });
});
