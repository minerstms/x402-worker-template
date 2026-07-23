import { describe, expect, it } from "vitest";
import { DEFAULT_PAY_TO } from "../src/config.js";
import { createApp } from "../src/index.js";
import {
  ENVIRONMENT_LABEL,
  PAY_PUBLIC_CONFIG_FIELDS,
} from "../src/pay-public-config.js";
import { PAY_CONTENT_SECURITY_POLICY } from "../src/routes/pay.js";
import { PAY_JS } from "../src/generated/pay-assets.js";

const testAppOptions = {
  syncFacilitatorOnStart: false,
  useStaticFacilitator: true,
} as const;

describe("/pay browser preflight routes", () => {
  it("returns HTML for GET /pay", async () => {
    const app = createApp({ ...testAppOptions });
    const res = await app.request("http://localhost/pay");
    expect(res.status).toBe(200);
    expect(res.headers.get("content-type")).toContain("text/html");
    expect(res.headers.get("Cache-Control")).toBe("no-store");
  });

  it("includes TESTNET warnings", async () => {
    const app = createApp({ ...testAppOptions });
    const html = await (await app.request("http://localhost/pay")).text();
    expect(html).toContain("BASE SEPOLIA TESTNET");
    expect(html).toContain("No real money");
  });

  it("includes gated payment controls without standalone Pay button", async () => {
    const app = createApp({ ...testAppOptions });
    const html = await (await app.request("http://localhost/pay")).text();
    expect(html).not.toMatch(/>\s*Pay\s*</i);
    expect(html).toContain("Sign and Submit One Testnet Payment");
    expect(html).toContain("Connect Wallet");
    expect(html).toContain("Load and Validate Payment Terms");
  });

  it("serves restrictive CSP on /pay", async () => {
    const app = createApp({ ...testAppOptions });
    const res = await app.request("http://localhost/pay");
    expect(res.headers.get("Content-Security-Policy")).toBe(
      PAY_CONTENT_SECURITY_POLICY,
    );
    expect(PAY_CONTENT_SECURITY_POLICY).not.toContain("unsafe-inline");
    expect(PAY_CONTENT_SECURITY_POLICY).not.toContain("unsafe-eval");
  });

  it("serves same-origin browser-safe /pay.js", async () => {
    const app = createApp({ ...testAppOptions });
    const res = await app.request("http://localhost/pay.js");
    expect(res.status).toBe(200);
    expect(res.headers.get("content-type")).toContain("javascript");
    expect(res.headers.get("Cache-Control")).toBe("no-store");
    const body = await res.text();
    expect(body).toBe(PAY_JS);
    expect(body).not.toContain("buyer-env");
    expect(body).not.toContain("node:fs");
    expect(body).not.toContain("privateKeyToAccount");
    expect(body).not.toContain("wrapFetchWithPayment");
    expect(body).toContain("createPaymentPayload");
  });

  it("serves same-origin /pay.css", async () => {
    const app = createApp({ ...testAppOptions });
    const res = await app.request("http://localhost/pay.css");
    expect(res.status).toBe(200);
    expect(res.headers.get("content-type")).toContain("text/css");
    expect(res.headers.get("Cache-Control")).toBe("no-store");
    expect((await res.text()).length).toBeGreaterThan(0);
  });

  it("returns only approved public fields from /pay/config", async () => {
    const app = createApp({ ...testAppOptions });
    const res = await app.request("http://localhost/pay/config");
    expect(res.status).toBe(200);
    expect(res.headers.get("Cache-Control")).toBe("no-store");
    const body = (await res.json()) as Record<string, unknown>;
    expect(Object.keys(body).sort()).toEqual([...PAY_PUBLIC_CONFIG_FIELDS].sort());
    expect(body.environmentLabel).toBe(ENVIRONMENT_LABEL);
    expect(body).not.toHaveProperty("facilitatorUrl");
    expect(body).not.toHaveProperty("privateKey");
  });

  it("reports paymentReady false for placeholder seller", async () => {
    const app = createApp({
      ...testAppOptions,
      env: { X402_PAY_TO_ADDRESS: DEFAULT_PAY_TO },
    });
    const body = (await (
      await app.request("http://localhost/pay/config")
    ).json()) as { paymentReady: boolean; sellerIsPlaceholder: boolean };
    expect(body.paymentReady).toBe(false);
    expect(body.sellerIsPlaceholder).toBe(true);
  });
});
