#!/usr/bin/env node
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { spawnSync } from "node:child_process";

const CANONICAL_OWNER = "minerstms";
const CANONICAL_REPO = "x402-worker-template";
const CANONICAL_FULL_NAME = `${CANONICAL_OWNER}/${CANONICAL_REPO}`;
const CANONICAL_HTTPS = `https://github.com/${CANONICAL_FULL_NAME}.git`;
const CANONICAL_HTTPS_NO_GIT = `https://github.com/${CANONICAL_FULL_NAME}`;
const CANONICAL_SSH_HOST = "github.com";
const CANONICAL_SSH = ["git", CANONICAL_SSH_HOST].join("@") + `:${CANONICAL_FULL_NAME}.git`;
const CANONICAL_PACKAGE_URL = `git+${CANONICAL_HTTPS}`;
const CANONICAL_HOMEPAGE = `${CANONICAL_HTTPS_NO_GIT}#readme`;
const CANONICAL_BUGS = `${CANONICAL_HTTPS_NO_GIT}/issues`;

function normalizeRemoteUrl(value) {
  const trimmed = value.trim();
  if (trimmed.startsWith("git+")) {
    return trimmed.slice(4);
  }
  return trimmed;
}

function isCanonicalRemoteUrl(value) {
  const normalized = normalizeRemoteUrl(value).replace(/\/+$/, "");
  return (
    normalized === CANONICAL_HTTPS ||
    normalized === CANONICAL_HTTPS_NO_GIT ||
    normalized === CANONICAL_SSH
  );
}

function readPackageMetadata(repoRoot) {
  const pkg = JSON.parse(readFileSync(join(repoRoot, "package.json"), "utf8"));
  return {
    license: pkg.license,
    repositoryUrl: pkg.repository?.url,
    homepage: pkg.homepage,
    bugsUrl: pkg.bugs?.url,
  };
}

function verifyPackageMetadata(metadata) {
  if (metadata.license !== "Apache-2.0") {
    console.error('package.json must declare "license": "Apache-2.0".');
    process.exit(1);
  }
  if (metadata.repositoryUrl !== CANONICAL_PACKAGE_URL) {
    console.error(`package.json repository.url must be ${CANONICAL_PACKAGE_URL}`);
    process.exit(1);
  }
  if (metadata.homepage !== CANONICAL_HOMEPAGE) {
    console.error(`package.json homepage must be ${CANONICAL_HOMEPAGE}`);
    process.exit(1);
  }
  if (metadata.bugsUrl !== CANONICAL_BUGS) {
    console.error(`package.json bugs.url must be ${CANONICAL_BUGS}`);
    process.exit(1);
  }
}

function hasOriginRemote(repoRoot) {
  const result = spawnSync("git", ["remote"], {
    cwd: repoRoot,
    encoding: "utf8",
  });
  if (result.status !== 0) {
    return false;
  }
  return result.stdout
    .trim()
    .split(/\n/)
    .filter(Boolean)
    .includes("origin");
}

function verifyGitOrigin(repoRoot) {
  const result = spawnSync("git", ["remote", "get-url", "origin"], {
    cwd: repoRoot,
    encoding: "utf8",
  });
  if (result.status !== 0) {
    console.error("origin remote is required for Git checkout canonical verification.");
    process.exit(1);
  }
  const originUrl = result.stdout.trim();
  if (!isCanonicalRemoteUrl(originUrl)) {
    console.error(`origin must identify ${CANONICAL_FULL_NAME}; found ${originUrl}`);
    process.exit(1);
  }
}

function main() {
  const repoRoot = process.cwd();
  const metadata = readPackageMetadata(repoRoot);
  verifyPackageMetadata(metadata);

  if (existsSync(join(repoRoot, ".git")) && hasOriginRemote(repoRoot)) {
    verifyGitOrigin(repoRoot);
    console.log(`Canonical repository check: PASS (${CANONICAL_FULL_NAME}, origin verified)`);
    return;
  }

  console.log(`Canonical repository check: PASS (${CANONICAL_FULL_NAME}, package metadata only)`);
}

export {
  CANONICAL_BUGS,
  CANONICAL_FULL_NAME,
  CANONICAL_HOMEPAGE,
  CANONICAL_HTTPS,
  CANONICAL_HTTPS_NO_GIT,
  CANONICAL_OWNER,
  CANONICAL_PACKAGE_URL,
  CANONICAL_REPO,
  CANONICAL_SSH,
  isCanonicalRemoteUrl,
  normalizeRemoteUrl,
};

main();
