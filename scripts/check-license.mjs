#!/usr/bin/env node
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";

const repoRoot = process.cwd();
const pkg = JSON.parse(readFileSync(join(repoRoot, "package.json"), "utf8"));
const licensePath = join(repoRoot, "LICENSE");
const NOTICE_PATH = join(repoRoot, "NOTICE");

const REQUIRED_LICENSE_MARKERS = [
  "Apache License",
  "Version 2.0, January 2004",
  "TERMS AND CONDITIONS FOR USE, REPRODUCTION, AND DISTRIBUTION",
  "END OF TERMS AND CONDITIONS",
];

function main() {
  if (!existsSync(licensePath)) {
    console.error("LICENSE file is missing.");
    process.exit(1);
  }

  if (pkg.license !== "Apache-2.0") {
    console.error('package.json must declare "license": "Apache-2.0".');
    process.exit(1);
  }

  const licenseText = readFileSync(licensePath, "utf8");
  for (const marker of REQUIRED_LICENSE_MARKERS) {
    if (!licenseText.includes(marker)) {
      console.error(`LICENSE file is missing required Apache-2.0 marker: ${marker}`);
      process.exit(1);
    }
  }

  if (existsSync(NOTICE_PATH)) {
    console.error("Unexpected NOTICE file; review third-party attribution obligations before release.");
    process.exit(1);
  }

  console.log("License check: PASS (Apache-2.0)");
  console.log("First-party project code is licensed under Apache-2.0.");
  console.log("Third-party npm dependencies retain their own licenses in package-lock.json.");
  console.log("No project-level NOTICE file is currently required.");
}

main();
