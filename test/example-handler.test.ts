import { describe, expect, it } from "vitest";
import { buildExampleResponse } from "../src/routes/example.js";

describe("example handler response", () => {
  it("returns deterministic normalized JSON", () => {
    const body = buildExampleResponse("hello", () => new Date("2026-07-21T14:00:00.000Z"));
    expect(body.success).toBe(true);
    expect(body.input).toBe("hello");
    expect(body.normalizedInput).toBe("hello");
    expect(body.characterCount).toBe(5);
    expect(body.service.id).toBe("x402-worker-template");
    expect(body.service.retrievedAt).toBe("2026-07-21T14:00:00.000Z");
  });
});
