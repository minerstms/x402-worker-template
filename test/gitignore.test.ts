import { execSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");

describe(".gitignore wallet rule", () => {
  it("does not use a broad wallet* ignore pattern", () => {
    const gitignore = readFileSync(join(ROOT, ".gitignore"), "utf8");
    expect(gitignore).not.toMatch(/^wallet\*$/m);
  });

  it("allows intended browser wallet source files to be tracked", () => {
    const tracked = execSync('git ls-files "src/browser/pay-wallet-state.ts"', {
      cwd: ROOT,
      encoding: "utf8",
    }).trim();
    expect(tracked).toBe("src/browser/pay-wallet-state.ts");
  });

  it("still ignores common local wallet secret filenames", () => {
    const gitignore = readFileSync(join(ROOT, ".gitignore"), "utf8");
    expect(gitignore).toContain("wallet.json");
    expect(gitignore).toContain("wallet.key");
    expect(gitignore).toContain("wallet.pem");
    expect(gitignore).toContain("wallet.*.json");
  });
});
