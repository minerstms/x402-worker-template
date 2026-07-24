import { execSync } from "node:child_process";
import {
  existsSync,
  mkdtempSync,
  mkdirSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

function run(command: string, cwd: string): void {
  try {
    execSync(command, {
      cwd,
      stdio: "pipe",
      encoding: "utf8",
      env: {
        ...process.env,
        CI: "true",
      },
    });
  } catch (error) {
    const execError = error as { stdout?: string; stderr?: string; message?: string };
    if (execError.stdout) process.stdout.write(execError.stdout);
    if (execError.stderr) process.stderr.write(execError.stderr);
    throw error;
  }
}

function extractZip(zipPath: string, destination: string): void {
  if (process.platform === "win32") {
    const escapedZip = zipPath.replace(/'/g, "''");
    const escapedDest = destination.replace(/'/g, "''");
    run(
      `powershell -NoProfile -Command "Expand-Archive -Path '${escapedZip}' -DestinationPath '${escapedDest}' -Force"`,
      process.cwd(),
    );
    return;
  }

  run(`unzip -q "${zipPath}" -d "${destination}"`, process.cwd());
}

function main(): void {
  const repoRoot = process.cwd();
  if (!existsSync(join(repoRoot, ".git"))) {
    throw new Error("verify:archive requires a Git checkout with .git metadata.");
  }

  const tempRoot = mkdtempSync(join(tmpdir(), "x402-release-archive-"));
  const archiveRoot = join(tempRoot, "checkout");
  const archiveZip = join(tempRoot, "archive.zip");

  try {
    mkdirSync(archiveRoot, { recursive: true });
    run(`git archive --format=zip -o "${archiveZip}" HEAD`, repoRoot);
    extractZip(archiveZip, archiveRoot);

    run("npm ci", archiveRoot);
    run("npm run check:actions", archiveRoot);
    run("npm test", archiveRoot);
    run("npm run typecheck", archiveRoot);
    run("npm run typecheck:mainnet", archiveRoot);

    const generatedMarker = join(archiveRoot, "src", "generated", "pay-assets.ts");
    if (!existsSync(generatedMarker)) {
      throw new Error("Archive checkout did not produce expected generated browser assets.");
    }

    const gitignore = readFileSync(join(archiveRoot, ".gitignore"), "utf8");
    for (const required of [
      ".env",
      ".dev.vars",
      ".wrangler/",
      "payai-supported.json",
      "dist/",
      "src/generated/",
    ]) {
      if (!gitignore.includes(required)) {
        throw new Error(`.gitignore in archive checkout is missing ${required}`);
      }
    }

    writeFileSync(join(archiveRoot, "archive-verification.ok"), "verified\n", "utf8");
  } finally {
    rmSync(tempRoot, { recursive: true, force: true });
  }
}

main();
