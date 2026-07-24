import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { SERVICE_ID, SERVICE_NAME } from "../src/config.js";
import { validateApiUrl } from "../src/buyer-guards.js";
import {
  ALLOWED_QUERY_KEY,
  BROWSER_DEMO_QUERY_VALUE,
  PAID_ROUTE,
  buildPaidRouteUrl,
} from "../src/pay-public-config.js";

const ROOT = join(import.meta.dirname, "..");

export const DOCUMENTED_CLONE_SURFACE_PATHS = [
  "src/config.ts",
  "package.json",
  "wrangler.toml",
  "src/openapi.ts",
  "src/routes/example.ts",
  "src/index.ts",
  "src/errors.ts",
  "src/payment.ts",
  "src/pay-public-config.ts",
  "src/buyer-guards.ts",
  "src/routes/pay.ts",
  "src/browser/terms-loader.ts",
  ".env.buyer.example",
  "README.md",
  "TEMPLATE_CHECKLIST.md",
] as const;

describe("clone surface contract", () => {
  it("documents the shared paid-route constants in pay-public-config", () => {
    expect(PAID_ROUTE).toBe("/v1/example");
    expect(ALLOWED_QUERY_KEY).toBe("value");
    expect(BROWSER_DEMO_QUERY_VALUE).toBe("browser-demo");
  });

  it("builds browser unpaid URLs from shared route constants", () => {
    expect(buildPaidRouteUrl("http://localhost:8787")).toBe(
      "http://localhost:8787/v1/example?value=browser-demo",
    );
    expect(buildPaidRouteUrl("http://localhost:8787", "hello")).toBe(
      "http://localhost:8787/v1/example?value=hello",
    );
  });

  it("lists the documented clone surfaces that must be edited during a rename", () => {
    for (const relativePath of DOCUMENTED_CLONE_SURFACE_PATHS) {
      expect(existsSync(join(ROOT, relativePath))).toBe(true);
    }
  });

  it("keeps buyer guards aligned with shared route constants", () => {
    const wrongPath = validateApiUrl(
      "http://localhost:8787/v1/other?value=hello",
    );
    expect(wrongPath.ok).toBe(false);
    if (wrongPath.ok) return;
    expect(wrongPath.reason).toContain(PAID_ROUTE);

    const wrongQuery = validateApiUrl(
      "http://localhost:8787/v1/example?message=hello",
    );
    expect(wrongQuery.ok).toBe(false);
    if (wrongQuery.ok) return;
    expect(wrongQuery.reason).toContain(ALLOWED_QUERY_KEY);

    const valid = validateApiUrl("http://localhost:8787/v1/example?value=hello");
    expect(valid.ok).toBe(true);
  });

  it("documents current template identity constants", () => {
    expect(SERVICE_NAME).toBe("x402 Paid Worker Template");
    expect(SERVICE_ID).toBe("x402-worker-template");
  });

  it("keeps buyer guards importing shared route constants", () => {
    const source = readFileSync(join(ROOT, "src/buyer-guards.ts"), "utf8");
    expect(source).toContain('from "./pay-public-config.js"');
    expect(source).toContain("PAID_ROUTE");
    expect(source).toContain("ALLOWED_QUERY_KEY");
    expect(source).not.toMatch(/pathname !== "\/v1\/example"/);
  });

  it("keeps browser terms loading on buildPaidRouteUrl", () => {
    const source = readFileSync(
      join(ROOT, "src/browser/terms-loader.ts"),
      "utf8",
    );
    expect(source).toContain("buildPaidRouteUrl");
    expect(source).not.toContain("buildPaidExampleUrl");
  });
});
