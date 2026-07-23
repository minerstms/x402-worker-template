import { describe, expect, it } from "vitest";
import { redactValue, shouldRedactKey, logStructured } from "../src/logging.js";

describe("logging redaction", () => {
  it("redacts sensitive keys recursively", () => {
    expect(shouldRedactKey("authorization")).toBe(true);
    expect(shouldRedactKey("PAYMENT-SIGNATURE")).toBe(true);
    expect(shouldRedactKey("api_key")).toBe(true);
    expect(shouldRedactKey("payment-required")).toBe(true);
    expect(shouldRedactKey("value")).toBe(false);

    const redacted = redactValue({
      requestId: "abc",
      value: "hello",
      authorization: "Bearer secret",
      nested: {
        privateKey: "0xabc",
        signature: "sig",
        ok: true,
      },
      headers: {
        "payment-signature": "pay",
        "content-type": "application/json",
      },
    }) as Record<string, unknown>;

    expect(redacted.requestId).toBe("abc");
    expect(redacted.value).toBe("hello");
    expect(redacted.authorization).toBe("[REDACTED]");
    const nested = redacted.nested as Record<string, unknown>;
    expect(nested.privateKey).toBe("[REDACTED]");
    expect(nested.signature).toBe("[REDACTED]");
    expect(nested.ok).toBe(true);
    const headers = redacted.headers as Record<string, unknown>;
    expect(headers["payment-signature"]).toBe("[REDACTED]");
    expect(headers["content-type"]).toBe("application/json");
  });

  it("writes structured JSON without leaking secrets", () => {
    const lines: string[] = [];
    logStructured(
      "info",
      {
        requestId: "r1",
        route: "/v1/example",
        api_key: "should-not-appear",
        paymentOutcome: "required",
      },
      (line) => lines.push(line),
    );
    expect(lines).toHaveLength(1);
    const parsed = JSON.parse(lines[0]!);
    expect(parsed.api_key).toBe("[REDACTED]");
    expect(parsed.paymentOutcome).toBe("required");
    expect(lines[0]).not.toContain("should-not-appear");
  });
});
