import { describe, expect, it } from "vitest";
import { DEFAULT_PAY_TO } from "../src/config.js";
import {
  applyBaseSepoliaPaymentPolicy,
  matchesBaseSepoliaPaymentTerms,
  requirement,
  validateBaseSepoliaPaymentRequirements,
} from "../src/payment-policy.js";

const VALID_PAY_TO = DEFAULT_PAY_TO;

describe("Base Sepolia payment policy", () => {
  it("accepts exact valid terms", () => {
    const req = requirement({ payTo: VALID_PAY_TO });
    expect(matchesBaseSepoliaPaymentTerms(req, VALID_PAY_TO)).toBe(true);
    expect(
      validateBaseSepoliaPaymentRequirements([req], VALID_PAY_TO),
    ).toEqual({ ok: true, requirement: req });
  });

  it("rejects timeout 299", () => {
    expect(
      matchesBaseSepoliaPaymentTerms(
        requirement({ maxTimeoutSeconds: 299 }),
        VALID_PAY_TO,
      ),
    ).toBe(false);
  });

  it("rejects timeout 301", () => {
    expect(
      matchesBaseSepoliaPaymentTerms(
        requirement({ maxTimeoutSeconds: 301 }),
        VALID_PAY_TO,
      ),
    ).toBe(false);
  });

  it("rejects missing EIP-712 name", () => {
    expect(
      matchesBaseSepoliaPaymentTerms(
        requirement({ extra: { version: "2" } }),
        VALID_PAY_TO,
      ),
    ).toBe(false);
  });

  it("rejects wrong EIP-712 name", () => {
    expect(
      matchesBaseSepoliaPaymentTerms(
        requirement({ extra: { name: "USD Coin", version: "2" } }),
        VALID_PAY_TO,
      ),
    ).toBe(false);
  });

  it("rejects missing EIP-712 version", () => {
    expect(
      matchesBaseSepoliaPaymentTerms(
        requirement({ extra: { name: "USDC" } }),
        VALID_PAY_TO,
      ),
    ).toBe(false);
  });

  it("rejects wrong EIP-712 version", () => {
    expect(
      matchesBaseSepoliaPaymentTerms(
        requirement({ extra: { name: "USDC", version: "1" } }),
        VALID_PAY_TO,
      ),
    ).toBe(false);
  });

  it("rejects duplicate otherwise-valid options", () => {
    const req = requirement({ payTo: VALID_PAY_TO });
    const result = validateBaseSepoliaPaymentRequirements(
      [req, { ...req }],
      VALID_PAY_TO,
    );
    expect(result.ok).toBe(false);
  });

  it("rejects altered seller", () => {
    expect(
      applyBaseSepoliaPaymentPolicy(
        [
          requirement({
            payTo: "0x1111111111111111111111111111111111111111",
          }),
        ],
        VALID_PAY_TO,
      ),
    ).toHaveLength(0);
  });

  it("rejects altered amount", () => {
    expect(
      applyBaseSepoliaPaymentPolicy(
        [requirement({ amount: "999" })],
        VALID_PAY_TO,
      ),
    ).toHaveLength(0);
  });

  it("rejects altered token", () => {
    expect(
      applyBaseSepoliaPaymentPolicy(
        [
          requirement({
            asset: "0x0000000000000000000000000000000000000001",
          }),
        ],
        VALID_PAY_TO,
      ),
    ).toHaveLength(0);
  });

  it("rejects mainnet network", () => {
    expect(
      applyBaseSepoliaPaymentPolicy(
        [requirement({ network: "eip155:8453" as `${string}:${string}` })],
        VALID_PAY_TO,
      ),
    ).toHaveLength(0);
  });
});
