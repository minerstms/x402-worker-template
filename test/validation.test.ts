import { describe, expect, it } from "vitest";
import { createApp } from "../src/index.js";
import { EXAMPLE_VALUE_MAX_LENGTH } from "../src/routes/example.js";

const testAppOptions = {
  syncFacilitatorOnStart: true,
  useStaticFacilitator: true,
} as const;

describe("example input validation", () => {
  it("missing value returns 400", async () => {
    let handlerRan = false;
    const app = createApp({
      ...testAppOptions,
      onExampleHandlerExecuted: () => {
        handlerRan = true;
      },
    });
    const res = await app.request("http://localhost/v1/example");
    expect(res.status).toBe(400);
    const body = (await res.json()) as {
      success: boolean;
      error: { code: string };
    };
    expect(body.success).toBe(false);
    expect(body.error.code).toBe("INVALID_VALUE");
    expect(handlerRan).toBe(false);
  });

  it("invalid value values return 400", async () => {
    let handlerRan = false;
    const app = createApp({
      ...testAppOptions,
      onExampleHandlerExecuted: () => {
        handlerRan = true;
      },
    });
    const cases = ["", " ", "  hello", "hello  ", "a".repeat(EXAMPLE_VALUE_MAX_LENGTH + 1)];
    for (const value of cases) {
      const res = await app.request(
        `http://localhost/v1/example?value=${encodeURIComponent(value)}`,
      );
      expect(res.status).toBe(400);
      const body = (await res.json()) as { error: { code: string } };
      expect(["MISSING_VALUE", "INVALID_VALUE"]).toContain(body.error.code);
    }
    expect(handlerRan).toBe(false);
  });

  it("repeated value parameters return 400", async () => {
    let handlerRan = false;
    const app = createApp({
      ...testAppOptions,
      onExampleHandlerExecuted: () => {
        handlerRan = true;
      },
    });
    const res = await app.request(
      "http://localhost/v1/example?value=hello&value=world",
    );
    expect(res.status).toBe(400);
    const body = (await res.json()) as { error: { code: string } };
    expect(body.error.code).toBe("INVALID_VALUE");
    expect(handlerRan).toBe(false);
  });

  it("unexpected query parameters return 400", async () => {
    const app = createApp({ ...testAppOptions });
    const res = await app.request(
      "http://localhost/v1/example?value=hello&debug=1",
    );
    expect(res.status).toBe(400);
  });

  it("valid unpaid request returns 402 and does not execute handler", async () => {
    let handlerRan = false;
    const app = createApp({
      ...testAppOptions,
      onExampleHandlerExecuted: () => {
        handlerRan = true;
      },
    });
    const res = await app.request(
      "http://localhost/v1/example?value=hello",
      { headers: { Accept: "application/json" } },
    );
    expect(res.status).toBe(402);
    expect(handlerRan).toBe(false);
  });
});
