import { describe, expect, it } from "vitest";
import { createApp } from "../src/index.js";
import { buildOpenApiDocument } from "../src/openapi.js";
import { buildExampleRouteConfig } from "../src/payment.js";
import { resolveConfig } from "../src/config.js";

describe("OpenAPI", () => {
  it("returns valid JSON with OpenAPI 3.1.x", async () => {
    const app = createApp({
      syncFacilitatorOnStart: true,
      useStaticFacilitator: true,
    });
    const res = await app.request("http://localhost/openapi.json");
    expect(res.status).toBe(200);
    const body = (await res.json()) as {
      openapi: string;
      paths: Record<string, unknown>;
    };
    expect(body.openapi).toMatch(/^3\.1(\.\d+)?$/);
    expect(body.paths["/health"]).toBeTruthy();
    expect(body.paths["/openapi.json"]).toBeTruthy();
    expect(body.paths["/v1/example"]).toBeTruthy();
  });

  it("documents accurate payment metadata", () => {
    const doc = buildOpenApiDocument(
      resolveConfig({
        X402_NETWORK: "eip155:84532",
        X402_PRICE_USD: "0.001",
      }),
    );
    expect(doc["x-payment"].priceUsd).toBe("0.001");
    expect(doc["x-payment"].priceAccept).toBe("$0.001");
    expect(doc["x-payment"].network).toBe("eip155:84532");
    expect(doc["x-payment"].networkName).toBe("Base Sepolia");
    expect(doc["x-template-provenance"]).toContain("f3d8f24");
    const example = doc.paths["/v1/example"].get;
    expect(example.responses["402"]).toBeTruthy();
    expect(example.responses["400"]).toBeTruthy();
    expect(JSON.stringify(example)).toContain("hello");
  });

  it("includes bazaar metadata shape without double-wrapping", () => {
    const config = resolveConfig();
    const route = buildExampleRouteConfig(config);
    expect(route.extensions).toBeTruthy();
    const bazaar = route.extensions?.bazaar as {
      info?: { input?: { queryParams?: { value?: string } } };
      schema?: unknown;
      bazaar?: unknown;
    };
    expect(bazaar).toBeTruthy();
    expect(bazaar.info).toBeTruthy();
    expect(bazaar.schema).toBeTruthy();
    expect(bazaar.bazaar).toBeUndefined();
    expect(bazaar.info?.input?.queryParams?.value).toBe("hello");
  });
});
