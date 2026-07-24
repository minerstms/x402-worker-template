import { execSync } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

const ROOT = join(import.meta.dirname, "..");

const TRACKED_TEXT_SUFFIXES = [
  ".md",
  ".ts",
  ".tsx",
  ".json",
  ".toml",
  ".yml",
  ".yaml",
  ".example",
  ".css",
  ".html",
] as const;

const PRIVATE_IDENTIFIER_PATTERNS = [
  new RegExp("mrr" + "adle", "i"),
  new RegExp("miner" + "stms", "i"),
  new RegExp("@gmail\\.com", "i"),
  /C:\\Users\\/i,
  /C:\/Users\//i,
] as const;

const PROOF_DOC = "docs/BASE_SEPOLIA_BROWSER_PAYMENT_PROOF.md";

function listTrackedTextFiles(): string[] {
  if (!existsSync(join(ROOT, ".git"))) {
    return [];
  }

  const output = execSync("git ls-files", {
    cwd: ROOT,
    encoding: "utf8",
  }).trim();

  if (!output) {
    return [];
  }

  return output
    .split(/\r?\n/)
    .filter((relativePath) =>
      TRACKED_TEXT_SUFFIXES.some((suffix) => relativePath.endsWith(suffix)),
    );
}

describe("public-release hygiene", () => {
  it("labels Base Sepolia proof as public-safe redacted evidence", () => {
    const proof = readFileSync(join(ROOT, PROOF_DOC), "utf8");
    expect(proof).toContain("PUBLIC-SAFE REDACTED TEST EVIDENCE");
    expect(proof).not.toMatch(new RegExp("mrr" + "adle", "i"));
    expect(proof).toContain("<testnet-worker-url>");
    expect(proof).toMatch(/intentionally omitted/i);
    expect(proof).toMatch(/cannot reproduce/i);
  });

  it("does not contain private identifiers in tracked text files", () => {
    const offenders: string[] = [];

    for (const relativePath of listTrackedTextFiles()) {
      const content = readFileSync(join(ROOT, relativePath), "utf8");
      for (const pattern of PRIVATE_IDENTIFIER_PATTERNS) {
        if (pattern.test(content)) {
          offenders.push(relativePath);
          break;
        }
      }
    }

    expect(offenders, offenders.join(", ")).toEqual([]);
  });

  it("pins direct dependencies to exact versions", () => {
    const pkg = JSON.parse(readFileSync(join(ROOT, "package.json"), "utf8")) as {
      dependencies?: Record<string, string>;
      devDependencies?: Record<string, string>;
    };

    const specs = {
      ...pkg.dependencies,
      ...pkg.devDependencies,
    };

    for (const [name, version] of Object.entries(specs)) {
      expect(version, name).not.toMatch(/^[\^~]/);
      if (name === "npm") continue;
      expect(version, name).toMatch(/^\d/);
    }
  });

  it("documents the pinned Node toolchain", () => {
    const nvmrc = readFileSync(join(ROOT, ".nvmrc"), "utf8").trim();
    const pkg = JSON.parse(readFileSync(join(ROOT, "package.json"), "utf8")) as {
      engines?: { node?: string; npm?: string };
    };

    expect(nvmrc).toBe("22.20.1");
    expect(pkg.engines?.node).toBe("22.20.1");
    expect(pkg.engines?.npm).toBeDefined();
  });

  it("includes security policy and CI workflows", () => {
    expect(existsSync(join(ROOT, "SECURITY.md"))).toBe(true);
    expect(existsSync(join(ROOT, ".github", "workflows", "ci.yml"))).toBe(true);
    expect(
      existsSync(join(ROOT, ".github", "workflows", "release-archive.yml")),
    ).toBe(true);
  });

  it("keeps README status claims aligned with disabled mainnet", () => {
    const readme = readFileSync(join(ROOT, "README.md"), "utf8");
    expect(readme).toMatch(/ready for authorized public publication/i);
    expect(readme).toMatch(/production mainnet paid route remains disabled/i);
    expect(readme).toMatch(/Apache-2.0/i);
    expect(readme).not.toMatch(/production facilitator was selected/i);
    expect(readme).not.toMatch(new RegExp("mrr" + "adle", "i"));
  });
});

describe("release archive verification script", () => {
  it("exists and documents archive verification steps", () => {
    const scriptPath = join(ROOT, "scripts", "verify-release-archive.ts");
    const script = readFileSync(scriptPath, "utf8");
    expect(script).toContain("git archive");
    expect(script).toContain("npm ci");
    expect(script).toContain("npm test");
    expect(script).toContain("payai-supported.json");
  });
});
