import { execSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

const ROOT = join(import.meta.dirname, "..");

const REQUIRED_GITIGNORE_PATTERNS = [
  ".env",
  ".env.*",
  "!.env.example",
  "!.env.buyer.example",
  ".dev.vars",
  ".dev.vars.*",
  "!.dev.vars.example",
  ".wrangler/",
  ".devtools/",
  "*.pem",
  "*.key",
  "*.wallet",
  "*.seed",
  ".npmrc",
  ".yarnrc",
  "payai-supported.json",
  "audit-captures/",
  "coverage/",
  "dist/",
  "dist-*/",
  "src/generated/",
] as const;

describe(".gitignore hardening", () => {
  const gitignore = readFileSync(join(ROOT, ".gitignore"), "utf8");

  it("does not use a broad wallet* ignore pattern", () => {
    expect(gitignore).not.toMatch(/^wallet\*$/m);
  });

  it("covers required public-release ignore patterns", () => {
    for (const pattern of REQUIRED_GITIGNORE_PATTERNS) {
      expect(gitignore, `missing ${pattern}`).toContain(pattern);
    }
  });

  it("allows intended browser wallet source files to be tracked", () => {
    const walletSource = "src/browser/pay-wallet-state.ts";
    if (!existsInRepo(walletSource)) {
      expect.fail(`${walletSource} must exist`);
    }

    if (existsSyncGit()) {
      const tracked = execSync(`git ls-files "${walletSource}"`, {
        cwd: ROOT,
        encoding: "utf8",
      }).trim();
      expect(tracked).toBe(walletSource);

      try {
        execSync(`git check-ignore -q "${walletSource}"`, {
          cwd: ROOT,
          stdio: "ignore",
        });
        expect.fail(`${walletSource} should not be ignored`);
      } catch (error) {
        expect((error as { status?: number }).status).toBe(1);
      }
    }
  });

  it("still ignores common local wallet secret filenames", () => {
    expect(gitignore).toContain("wallet.json");
    expect(gitignore).toContain("wallet.key");
    expect(gitignore).toContain("wallet.pem");
    expect(gitignore).toContain("wallet.*.json");
  });
});

function existsInRepo(relativePath: string): boolean {
  try {
    readFileSync(join(ROOT, relativePath), "utf8");
    return true;
  } catch {
    return false;
  }
}

function existsSyncGit(): boolean {
  try {
    readFileSync(join(ROOT, ".git"), "utf8");
    return true;
  } catch {
    try {
      execSync("git rev-parse --git-dir", { cwd: ROOT, stdio: "ignore" });
      return true;
    } catch {
      return false;
    }
  }
}
