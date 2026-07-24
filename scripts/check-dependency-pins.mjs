#!/usr/bin/env node
import { readFileSync, readdirSync, statSync } from "node:fs";
import { join, relative } from "node:path";

const repoRoot = process.cwd();
const pkg = JSON.parse(readFileSync(join(repoRoot, "package.json"), "utf8"));
const lock = JSON.parse(readFileSync(join(repoRoot, "package-lock.json"), "utf8"));
const toolchain = JSON.parse(readFileSync(join(repoRoot, ".github", "toolchain.json"), "utf8"));

const EXACT_VERSION = /^\d+\.\d+\.\d+(?:[-+][A-Za-z0-9.-]+)?$/;
const REVIEWED_PACKAGES = {
  "@x402/core": "2.19.0",
  "@x402/evm": "2.19.0",
  "@x402/hono": "2.19.0",
  "@x402/fetch": "2.19.0",
  "@x402/extensions": "2.19.0",
};
const MUTABLE_NODE_PATTERNS = [
  /\bnode-version:\s*["']?(?:22|22\.x|lts\/\*|latest|current|node)["']?\b/i,
  /\bcheck-latest:\s*true\b/i,
];

function fail(message) {
  console.error(message);
  process.exit(1);
}

function collectSourceFiles(dir, out = []) {
  for (const entry of readdirSync(dir)) {
    const fullPath = join(dir, entry);
    const stat = statSync(fullPath);
    if (stat.isDirectory()) {
      if (entry === "node_modules" || entry === "generated") continue;
      collectSourceFiles(fullPath, out);
      continue;
    }
    if (/\.(ts|tsx|mts|cts)$/.test(entry)) {
      out.push(fullPath);
    }
  }
  return out;
}

function packageNameFromSpecifier(specifier) {
  if (specifier.startsWith("@")) {
    const parts = specifier.split("/");
    return `${parts[0]}/${parts[1]}`;
  }
  return specifier.split("/")[0];
}

function scanDirectImports() {
  const runtimeRoots = [join(repoRoot, "src")];
  const importRegex = /\bfrom\s+["']([^"']+)["']/g;
  const dynamicImportRegex = /\bimport\s*\(\s*["']([^"']+)["']\s*\)/g;
  const offenders = [];

  for (const root of runtimeRoots) {
    for (const file of collectSourceFiles(root)) {
      const content = readFileSync(file, "utf8");
      const relativePath = relative(repoRoot, file).replace(/\\/g, "/");
      for (const regex of [importRegex, dynamicImportRegex]) {
        regex.lastIndex = 0;
        let match;
        while ((match = regex.exec(content)) !== null) {
          const specifier = match[1];
          if (specifier.startsWith(".") || specifier.startsWith("node:")) continue;
          if (specifier.startsWith("cloudflare:")) continue;
          const packageName = packageNameFromSpecifier(specifier);
          const lineStart = content.lastIndexOf("\n", match.index) + 1;
          const lineEnd = content.indexOf("\n", match.index);
          const line = content.slice(lineStart, lineEnd === -1 ? content.length : lineEnd);
          const allowedPackages =
            /^\s*import\s+type\b/.test(line)
              ? { ...(pkg.dependencies ?? {}), ...(pkg.devDependencies ?? {}) }
              : (pkg.dependencies ?? {});
          if (!(packageName in allowedPackages)) {
            offenders.push(`${relativePath} -> ${packageName}`);
          }
        }
      }
    }
  }

  return offenders;
}

function validateToolchainManifest() {
  if (!toolchain.node || !toolchain.npm) {
    fail(".github/toolchain.json must define node and npm.");
  }
  if (!EXACT_VERSION.test(toolchain.node) || !EXACT_VERSION.test(toolchain.npm)) {
    fail(".github/toolchain.json must use exact semver values for node and npm.");
  }
}

function validateToolchainDeclarations() {
  validateToolchainManifest();

  const nvmrc = readFileSync(join(repoRoot, ".nvmrc"), "utf8").trim();
  const expectedPackageManager = `npm@${toolchain.npm}`;

  if (nvmrc !== toolchain.node) {
    fail(`.nvmrc (${nvmrc}) must match toolchain manifest node (${toolchain.node})`);
  }
  if (pkg.engines?.node !== toolchain.node) {
    fail(`engines.node (${pkg.engines?.node}) must match toolchain manifest node (${toolchain.node})`);
  }
  if (pkg.packageManager !== expectedPackageManager) {
    fail(
      `packageManager (${pkg.packageManager}) must match toolchain manifest npm (${expectedPackageManager})`,
    );
  }
  if (pkg.engines?.npm !== toolchain.npm) {
    fail(`engines.npm (${pkg.engines?.npm}) must match toolchain manifest npm (${toolchain.npm})`);
  }
  if (nvmrc !== pkg.engines?.node) {
    fail(`.nvmrc (${nvmrc}) must match engines.node (${pkg.engines?.node})`);
  }

  const rootLock = lock.packages?.[""];
  if (rootLock?.engines?.node !== toolchain.node) {
    fail(`package-lock.json engines.node must match toolchain manifest node (${toolchain.node})`);
  }
  if (rootLock?.engines?.npm !== toolchain.npm) {
    fail(`package-lock.json engines.npm must match toolchain manifest npm (${toolchain.npm})`);
  }
}

function validateWorkflowToolchain() {
  const workflowsDir = join(repoRoot, ".github", "workflows");
  for (const name of readdirSync(workflowsDir)) {
    if (!/\.ya?ml$/i.test(name)) continue;
    const content = readFileSync(join(workflowsDir, name), "utf8");
    if (!content.includes("node-version-file: .nvmrc") && !content.includes('node-version-file: ".nvmrc"')) {
      fail(`${name} must use node-version-file: .nvmrc for Node selection`);
    }
    for (const pattern of MUTABLE_NODE_PATTERNS) {
      if (pattern.test(content)) {
        fail(`${name} contains a mutable Node toolchain alias`);
      }
    }
  }
}

function main() {
  if (pkg.private !== true) {
    fail("package.json must keep private: true");
  }

  if (!pkg.packageManager) {
    fail("package.json must define packageManager with the validated npm version");
  }

  if (!/^\d+$/.test(String(lock.lockfileVersion))) {
    fail("package-lock.json lockfileVersion is unsupported");
  }

  const rootLock = lock.packages?.[""];
  if (!rootLock) {
    fail("package-lock.json missing root package metadata");
  }

  validateToolchainDeclarations();
  validateWorkflowToolchain();

  for (const section of ["dependencies", "devDependencies"]) {
    for (const [name, version] of Object.entries(pkg[section] ?? {})) {
      if (!EXACT_VERSION.test(version)) {
        fail(`Dependency ${name} must use an exact version, found ${version}`);
      }
      if (rootLock[section]?.[name] !== version) {
        fail(
          `Lockfile root metadata mismatch for ${name}: package.json=${version} lockfile=${rootLock[section]?.[name]}`,
        );
      }
    }
  }

  for (const [name, version] of Object.entries(REVIEWED_PACKAGES)) {
    if (pkg.dependencies?.[name] !== version) {
      fail(`Reviewed package ${name} must remain pinned to ${version}`);
    }
  }

  const offenders = scanDirectImports();
  if (offenders.length > 0) {
    fail(
      `Undeclared runtime imports detected:\n${offenders.map((entry) => `- ${entry}`).join("\n")}`,
    );
  }

  console.log("Dependency pin check: PASS");
}

main();
