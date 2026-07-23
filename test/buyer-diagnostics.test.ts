import { describe, expect, it } from "vitest";
import {
  buildBuyerErrorReport,
  extractBuyerErrorDiagnostic,
  paymentPayloadPrerequisites,
  sanitizeBuyerString,
  sanitizeBuyerValue,
} from "../src/buyer-diagnostics.js";
import { requirement } from "../src/buyer-guards.js";

const TEST_KEY = "0x" + "11".repeat(32);
const TEST_BUYER = "0x70997970C51812dc3A010C7d01b50e0d17dc79C8";
const TEST_SELLER = "0x000000000000000000000000000000000000dEaD";

describe("buyer diagnostics sanitizer", () => {
  it("redacts private keys, addresses, and payment headers", () => {
    const context = {
      privateKey: TEST_KEY,
      buyerAddress: TEST_BUYER,
      sellerAddress: TEST_SELLER,
      envValues: {
        EVM_PRIVATE_KEY: TEST_KEY,
        EXPECTED_PAY_TO_ADDRESS: TEST_SELLER,
      },
    };

    const input = {
      stage: "create_payment_payload",
      message: `key=${TEST_KEY} buyer=${TEST_BUYER} seller=${TEST_SELLER}`,
      headers: {
        "payment-signature": "0x" + "aa".repeat(80),
        authorization: "Bearer secret",
      },
    };

    const sanitized = sanitizeBuyerValue(input, context) as Record<string, unknown>;
    const serialized = JSON.stringify(sanitized);

    expect(serialized).not.toContain(TEST_KEY);
    expect(serialized).not.toContain(TEST_BUYER);
    expect(serialized).not.toContain(TEST_SELLER);
    expect((sanitized.headers as Record<string, string>)["payment-signature"]).toBe(
      "[REDACTED]",
    );
    expect(sanitizeBuyerString(input.message, context)).not.toContain(TEST_KEY);
    expect(sanitizeBuyerString(input.message, context)).toContain("[REDACTED]");
  });

  it("preserves safe diagnostic fields", () => {
    const diagnostic = extractBuyerErrorDiagnostic(
      new Error("Failed to create payment payload: EIP-712 domain parameters required"),
      "create_payment_payload",
      { sellerAddress: TEST_SELLER },
    );

    expect(diagnostic.stage).toBe("create_payment_payload");
    expect(diagnostic.failurePhase).toBe("during_local_signing");
    expect(diagnostic.message).toContain("EIP-712 domain parameters");
    expect(diagnostic.paymentBearingRequestLikelySent).toBe(false);
    expect(diagnostic.diagnosticId).toMatch(/^buyer-create_payment_payload-/);
  });

  it("detects missing EIP-712 prerequisites in payment requirements", () => {
    const missing = paymentPayloadPrerequisites(requirement({ extra: {} }));
    expect(missing.ok).toBe(false);
    if (!missing.ok) {
      expect(missing.reason).toMatch(/extra\.name and extra\.version/i);
    }

    const present = paymentPayloadPrerequisites(
      requirement({ extra: { name: "USDC", version: "2" } }),
    );
    expect(present.ok).toBe(true);
  });

  it("builds a generic message with structured diagnostic payload", () => {
    const report = buildBuyerErrorReport(
      new Error("Failed to create payment payload: signer unavailable"),
      "create_payment_payload",
      { privateKey: TEST_KEY },
    );

    expect(report.message).toMatch(/Buyer script failed/i);
    expect(report.diagnostic.stage).toBe("create_payment_payload");
    expect(JSON.stringify(report)).not.toContain(TEST_KEY);
  });
});
