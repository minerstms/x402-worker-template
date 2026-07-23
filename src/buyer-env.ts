import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";

export function loadEnvFile(path: string): void {
  if (!existsSync(path)) return;
  const text = readFileSync(path, "utf8");
  for (const line of text.split(/\r?\n/)) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) continue;
    const eq = trimmed.indexOf("=");
    if (eq <= 0) continue;
    const key = trimmed.slice(0, eq).trim();
    let value = trimmed.slice(eq + 1).trim();
    if (
      (value.startsWith('"') && value.endsWith('"')) ||
      (value.startsWith("'") && value.endsWith("'"))
    ) {
      value = value.slice(1, -1);
    }
    if (!(key in process.env)) {
      process.env[key] = value;
    }
  }
}

export function loadBuyerEnv(cwd: string = process.cwd()): void {
  loadEnvFile(resolve(cwd, ".env.buyer"));
  loadEnvFile(resolve(cwd, ".env"));
}

export function readBuyerEnvSnapshot(): Record<string, string | undefined> {
  return {
    API_URL: process.env.API_URL,
    EXPECTED_REMOTE_API_ORIGIN: process.env.EXPECTED_REMOTE_API_ORIGIN,
    EXPECTED_PAY_TO_ADDRESS: process.env.EXPECTED_PAY_TO_ADDRESS,
    ALLOW_TESTNET_PAYMENT: process.env.ALLOW_TESTNET_PAYMENT,
    X402_NETWORK: process.env.X402_NETWORK,
    EVM_PRIVATE_KEY: process.env.EVM_PRIVATE_KEY,
  };
}
