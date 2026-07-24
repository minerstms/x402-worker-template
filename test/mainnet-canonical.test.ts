import { describe, expect, it } from "vitest";
import {
  buildAuthCommitment,
  buildRecordKey,
  buildTermsFingerprint,
} from "../src/mainnet/idempotency/canonical-keys.js";
import {
  CanonicalJsonError,
  canonicalizeJsonValue,
  sha256Hex,
} from "../src/mainnet/idempotency/canonical-json.js";

describe("mainnet canonical JSON and keys", () => {
  it("canonical JSON is stable across object key order", async () => {
    const first = canonicalizeJsonValue({ b: 2, a: 1, nested: { z: true, y: false } });
    const second = canonicalizeJsonValue({ nested: { y: false, z: true }, a: 1, b: 2 });
    expect(first).toBe(second);
    expect(await sha256Hex(first)).toBe(await sha256Hex(second));
  });

  it("unsupported canonical values rejected", () => {
    expect(() => canonicalizeJsonValue(undefined)).toThrow(CanonicalJsonError);
    expect(() => canonicalizeJsonValue(Number.NaN)).toThrow(CanonicalJsonError);
    expect(() => canonicalizeJsonValue(Number.POSITIVE_INFINITY)).toThrow(
      CanonicalJsonError,
    );
    expect(() => canonicalizeJsonValue({ value: () => undefined })).toThrow(
      CanonicalJsonError,
    );
  });

  it("terms fingerprint changes when matched amount changes", async () => {
    const base = {
      scheme: "exact",
      network: "eip155:8453",
      asset: "0x833589fcd6edb6e08f4c7c32d4f71b54bda02913",
      amount: "1000",
      payTo: "0x000000000000000000000000000000000000dEaD",
      httpMethod: "GET",
      normalizedRoute: "/v1/example",
      normalizedQuery: { value: "demo" },
    };
    const first = await buildTermsFingerprint(base);
    const second = await buildTermsFingerprint({ ...base, amount: "1001" });
    expect(first).not.toBe(second);
  });

  it("terms fingerprint changes when matched seller changes", async () => {
    const base = {
      scheme: "exact",
      network: "eip155:8453",
      asset: "0x833589fcd6edb6e08f4c7c32d4f71b54bda02913",
      amount: "1000",
      payTo: "0x000000000000000000000000000000000000dEaD",
      httpMethod: "GET",
      normalizedRoute: "/v1/example",
      normalizedQuery: { value: "demo" },
    };
    const first = await buildTermsFingerprint(base);
    const second = await buildTermsFingerprint({
      ...base,
      payTo: "0x2222222222222222222222222222222222222222",
    });
    expect(first).not.toBe(second);
  });

  it("auth commitment changes when nonce changes", async () => {
    const base = {
      network: "eip155:8453",
      from: "0x1111111111111111111111111111111111111111",
      authorizationNonce: "nonce-a",
      to: "0x000000000000000000000000000000000000dEaD",
      value: "1000",
      validAfter: "0",
      validBefore: "9999999999",
      verifyingContract: "0x833589fcd6edb6e08f4c7c32d4f71b54bda02913",
    };
    const first = await buildAuthCommitment(base);
    const second = await buildAuthCommitment({ ...base, authorizationNonce: "nonce-b" });
    expect(first).not.toBe(second);
  });

  it("record key binds payment ID and terms", async () => {
    const paymentIdentifier = "pay_7d5d747be160e280";
    const termsFingerprint = await buildTermsFingerprint({
      scheme: "exact",
      network: "eip155:8453",
      asset: "0x833589fcd6edb6e08f4c7c32d4f71b54bda02913",
      amount: "1000",
      payTo: "0x000000000000000000000000000000000000dEaD",
      httpMethod: "GET",
      normalizedRoute: "/v1/example",
      normalizedQuery: { value: "demo" },
    });
    const recordKey = await buildRecordKey(paymentIdentifier, termsFingerprint);
    const otherKey = await buildRecordKey("pay_aaaaaaaaaaaaaaaa", termsFingerprint);
    expect(recordKey).toMatch(/^[0-9a-f]{64}$/);
    expect(recordKey).not.toBe(otherKey);
  });
});
