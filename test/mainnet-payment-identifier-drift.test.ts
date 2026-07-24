import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import {
  PAYMENT_ID_MAX_LENGTH,
  PAYMENT_ID_MIN_LENGTH,
  PAYMENT_ID_PATTERN,
  paymentIdentifierSchema,
} from "@x402/extensions/payment-identifier";

const projectRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const extensionsPackage = JSON.parse(
  readFileSync(
    path.join(projectRoot, "node_modules/@x402/extensions/package.json"),
    "utf8",
  ),
) as { version: string };

describe("mainnet payment identifier drift guard", () => {
  it("asserts installed @x402/extensions version is exactly 2.19.0", () => {
    expect(extensionsPackage.version).toBe("2.19.0");
  });

  it("matches exported payment identifier schema without compiling AJV", () => {
    expect(paymentIdentifierSchema.$schema).toBe(
      "https://json-schema.org/draft/2020-12/schema",
    );
    expect(paymentIdentifierSchema.type).toBe("object");
    expect(paymentIdentifierSchema.required).toEqual(["required"]);
    expect(paymentIdentifierSchema.properties.required.type).toBe("boolean");
    expect(paymentIdentifierSchema.properties.id.type).toBe("string");
    expect(paymentIdentifierSchema.properties.id.minLength).toBe(PAYMENT_ID_MIN_LENGTH);
    expect(paymentIdentifierSchema.properties.id.maxLength).toBe(PAYMENT_ID_MAX_LENGTH);
    expect(paymentIdentifierSchema.properties.id.pattern).toBe(PAYMENT_ID_PATTERN.source);
    expect(Object.keys(paymentIdentifierSchema.properties)).toEqual(["required", "id"]);
  });

  it("requires security review when workerd-safe source loses parity comment", () => {
    const source = readFileSync(
      path.join(
        projectRoot,
        "src/mainnet/idempotency/payment-identifier-workerd-safe.ts",
      ),
      "utf8",
    );
    expect(source).toContain("test/mainnet-payment-identifier-drift.test.ts");
    expect(source).toContain("without runtime JSON Schema");
    expect(source).toContain("compilation");
    expect(source).not.toMatch(/\bimport\s+.*ajv/i);
  });
});
