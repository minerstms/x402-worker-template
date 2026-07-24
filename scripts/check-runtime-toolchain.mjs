#!/usr/bin/env node
import { spawnSync } from "node:child_process";
import { dirname, join } from "node:path";

const REQUIRED_NODE = "v22.23.1";
const REQUIRED_NPM = "10.9.8";

function fail(message) {
  console.error(message);
  process.exit(1);
}

function readNpmVersion() {
  const npmCli = join(dirname(process.execPath), "node_modules", "npm", "bin", "npm-cli.js");
  const result = spawnSync(process.execPath, [npmCli, "--version"], {
    encoding: "utf8",
    env: process.env,
  });
  if (result.status !== 0 || !result.stdout?.trim()) {
    fail("Unable to determine npm version.");
  }
  return result.stdout.trim();
}

function main() {
  if (process.version !== REQUIRED_NODE) {
    fail(`Runtime Node version must be ${REQUIRED_NODE}, found ${process.version}.`);
  }

  const npmVersion = readNpmVersion();
  if (npmVersion !== REQUIRED_NPM) {
    fail(`Runtime npm version must be ${REQUIRED_NPM}, found ${npmVersion}.`);
  }

  console.log(`Runtime toolchain check: PASS (Node ${REQUIRED_NODE}, npm ${REQUIRED_NPM})`);
}

main();
