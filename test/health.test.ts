import { describe, expect, it } from "vitest";
import { createApp } from "../src/index.js";

describe("GET /health", () => {
  it("returns 200 with healthy payload", async () => {
    const app = createApp({
      syncFacilitatorOnStart: true,
      useStaticFacilitator: true,
    });
    const res = await app.request("http://localhost/health");
    expect(res.status).toBe(200);
    const body = (await res.json()) as {
      success: boolean;
      service: string;
      status: string;
      timestamp: string;
    };
    expect(body.success).toBe(true);
    expect(body.service).toBe("x402 Paid Worker Template");
    expect(body.status).toBe("healthy");
    expect(typeof body.timestamp).toBe("string");
  });
});
