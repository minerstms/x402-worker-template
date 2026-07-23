import { execSync } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const WALLET_SOURCE = "src/browser/pay-wallet-state.ts";

describe(".gitignore wallet rule", () => {
  it("does not use a broad wallet* ignore pattern", () => {
    const gitignore = readFileSync(join(ROOT, ".gitignore"), "utf8");
    expect(gitignore).not.toMatch(/^wallet\*$/m);
  });

  it("allows intended browser wallet source files to be tracked", () => {
    expect(existsSync(join(ROOT, WALLET_SOURCE))).toBe(true);

    if (existsSync(join(ROOT, ".git"))) {
      const tracked = execSync(`git ls-files "${WALLET_SOURCE}"`, {
        cwd: ROOT,
        encoding: "utf8",
      }).trim();
      expect(tracked).toBe(WALLET_SOURCE);

      try {
        execSync(`git check-ignore -q "${WALLET_SOURCE}"`, {
          cwd: ROOT,
          stdio: "ignore",
        });
        expect.fail(`${WALLET_SOURCE} should not be ignored`);
      } catch (error) {
        expect((error as { status?: number }).status).toBe(1);
      }
      return;
    }

    const gitignore = readFileSync(join(ROOT, ".gitignore"), "utf8");
    expect(gitignore).not.toMatch(/^wallet\*$/m);
    expect(WALLET_SOURCE).not.toMatch(/^wallet\.(json|key|pem)$/);
  });

  it("still ignores common local wallet secret filenames", () => {
    const gitignore = readFileSync(join(ROOT, ".gitignore"), "utf8");
    expect(gitignore).toContain("wallet.json");
    expect(gitignore).toContain("wallet.key");
    expect(gitignore).toContain("wallet.pem");
    expect(gitignore).toContain("wallet.*.json");
  });
});
