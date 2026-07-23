import { describe, expect, it } from "vitest";
import {
  ALLOWED_SELLER_NETWORK,
  assertAllowedSellerNetwork,
  BASE_SEPOLIA_USDC_EIP712_NAME,
  BASE_SEPOLIA_USDC_EIP712_VERSION,
  resolveConfig,
} from "../src/config.js";

describe("seller network lock", () => {
  it("accepts Base Sepolia", () => {
    expect(() => assertAllowedSellerNetwork(ALLOWED_SELLER_NETWORK)).not.toThrow();
    expect(
      resolveConfig({ X402_NETWORK: ALLOWED_SELLER_NETWORK }).network,
    ).toBe(ALLOWED_SELLER_NETWORK);
  });

  it.each([
    ["Base mainnet", "eip155:8453"],
    ["wildcard", "eip155:*"],
    ["another EVM network", "eip155:11155111"],
    ["blank", ""],
    ["malformed", "not-a-network"],
  ])("rejects %s network", (_label, network) => {
    expect(() => assertAllowedSellerNetwork(network)).toThrow(/84532/);
    expect(() => resolveConfig({ X402_NETWORK: network })).toThrow();
  });

  it("pins proven Base Sepolia test-USDC EIP-712 domain metadata", () => {
    expect(BASE_SEPOLIA_USDC_EIP712_NAME).toBe("USDC");
    expect(BASE_SEPOLIA_USDC_EIP712_VERSION).toBe("2");
  });
});
