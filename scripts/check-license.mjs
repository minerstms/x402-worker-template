#!/usr/bin/env node
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";

const repoRoot = process.cwd();
const pkg = JSON.parse(readFileSync(join(repoRoot, "package.json"), "utf8"));
const licensePath = join(repoRoot, "LICENSE");

function main() {
  if (existsSync(licensePath)) {
    console.error("LICENSE file is present but no license has been owner-approved.");
    process.exit(1);
  }

  if (pkg.license) {
    console.error(`package.json must not claim license ${pkg.license} without owner approval.`);
    process.exit(1);
  }

  console.warn("LICENSE DECISION REQUIRED BEFORE PUBLIC REUSE");
  console.warn(
    "Public visibility without a license does not grant reuse rights. Owner review options include MIT, Apache-2.0, or proprietary/all rights reserved.",
  );
  console.log("License decision check: WARNING (release remains incomplete)");
}

main();
