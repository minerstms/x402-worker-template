import { describe, expect, it } from "vitest";
import {
  applyBaseSepoliaPaymentPolicy,
  BASE_SEPOLIA,
  BASE_SEPOLIA_USDC_ASSET,
  BUYER_FETCH_REDIRECT,
  evaluateBuyerGuards,
  matchesBaseSepoliaPaymentTerms,
  requirement,
  selectBaseSepoliaPaymentRequirement,
  validateApiUrl,
  validateExpectedRemoteApiOrigin,
  validateLocalApiUrl,
  validatePrivateKeyFormat,
} from "../src/buyer-guards.js";

const VALID_KEY = "0x" + "11".repeat(32);
const VALID_PAY_TO = "0x000000000000000000000000000000000000dEaD";
const VALID_API = "http://localhost:8787/v1/example?value=hello";
const VALID_LOCALHOST_API =
  "http://127.0.0.1:8787/v1/example?value=hello";
const EXAMPLE_REMOTE_ORIGIN = "https://x402-worker-template.example-subdomain.workers.dev";
const VALID_REMOTE_API = `${EXAMPLE_REMOTE_ORIGIN}/v1/example?value=hello`;

function validConfig(overrides: Partial<Parameters<typeof evaluateBuyerGuards>[0]> = {}) {
  return {
    apiUrl: VALID_API,
    evmPrivateKey: VALID_KEY,
    allowTestnetPayment: true,
    expectedPayToAddress: VALID_PAY_TO,
    network: BASE_SEPOLIA,
    ...overrides,
  };
}

describe("buyer guards", () => {
  it("refuses when private key absent", () => {
    const result = evaluateBuyerGuards(
      validConfig({ evmPrivateKey: undefined }),
    );
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.reason).toMatch(/EVM_PRIVATE_KEY/i);
    }
  });

  it("refuses malformed private key without echoing the supplied value", () => {
    const malformed = "0xnot-a-valid-private-key-material";
    const result = validatePrivateKeyFormat(malformed);
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.reason).not.toContain(malformed);
      expect(result.reason).toMatch(/64-character hexadecimal/i);
    }

    const guard = evaluateBuyerGuards(validConfig({ evmPrivateKey: malformed }));
    expect(guard.ok).toBe(false);
    if (!guard.ok) {
      expect(guard.reason).not.toContain(malformed);
    }
  });

  it("refuses testnet payment unless ALLOW_TESTNET_PAYMENT=true", () => {
    const result = evaluateBuyerGuards(
      validConfig({ allowTestnetPayment: false }),
    );
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.reason).toMatch(/ALLOW_TESTNET_PAYMENT/i);
    }
  });

  it("allows Base Sepolia when explicitly enabled", () => {
    const result = evaluateBuyerGuards(validConfig());
    expect(result.ok).toBe(true);
  });

  it("allows 127.0.0.1 local API URL", () => {
    const result = evaluateBuyerGuards(
      validConfig({ apiUrl: VALID_LOCALHOST_API }),
    );
    expect(result.ok).toBe(true);
  });

  it("allows exact configured HTTPS workers.dev origin", () => {
    const result = evaluateBuyerGuards(
      validConfig({
        apiUrl: VALID_REMOTE_API,
        expectedRemoteApiOrigin: EXAMPLE_REMOTE_ORIGIN,
      }),
    );
    expect(result.ok).toBe(true);
  });

  it("keeps buyer fetch redirects disabled", () => {
    expect(BUYER_FETCH_REDIRECT).toBe("error");
  });

  it("refuses non-local API URL", () => {
    const cases = [
      "https://localhost:8787/v1/example?value=hello",
      "http://example.com:8787/v1/example?value=hello",
      "http://localhost:8788/v1/example?value=hello",
      "http://localhost:8787/v1/example",
      "http://localhost:8787/v1/example?value=hello&value=world",
    ];

    for (const apiUrl of cases) {
      const result = validateLocalApiUrl(apiUrl);
      expect(result.ok).toBe(false);
    }
  });

  it("requires EXPECTED_PAY_TO_ADDRESS", () => {
    const result = evaluateBuyerGuards(
      validConfig({ expectedPayToAddress: undefined }),
    );
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.reason).toMatch(/EXPECTED_PAY_TO_ADDRESS/i);
    }
  });

  it("refuses every network other than Base Sepolia", () => {
    const result = evaluateBuyerGuards(
      validConfig({ network: "eip155:8453" }),
    );
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.reason).toMatch(/84532/);
    }
  });
});

describe("remote API URL guards", () => {
  it.each([
    [
      "remote URL when EXPECTED_REMOTE_API_ORIGIN is absent",
      VALID_REMOTE_API,
      undefined,
    ],
    [
      "different workers.dev subdomain",
      "https://other-subdomain.workers.dev/v1/example?value=hello",
      EXAMPLE_REMOTE_ORIGIN,
    ],
    [
      "parent hostname trick",
      "https://x402-worker-template.example-subdomain.workers.dev.evil.test/v1/example?value=hello",
      EXAMPLE_REMOTE_ORIGIN,
    ],
    [
      "hostname merely containing workers.dev",
      "https://notworkers.dev/v1/example?value=hello",
      EXAMPLE_REMOTE_ORIGIN,
    ],
    [
      "HTTP workers.dev URL",
      "http://x402-worker-template.example-subdomain.workers.dev/v1/example?value=hello",
      EXAMPLE_REMOTE_ORIGIN,
    ],
    [
      "extra query parameters",
      `${VALID_REMOTE_API}&debug=1`,
      EXAMPLE_REMOTE_ORIGIN,
    ],
    [
      "missing value",
      `${EXAMPLE_REMOTE_ORIGIN}/v1/example`,
      EXAMPLE_REMOTE_ORIGIN,
    ],
    [
      "multiple value parameters",
      `${EXAMPLE_REMOTE_ORIGIN}/v1/example?value=hello&value=world`,
      EXAMPLE_REMOTE_ORIGIN,
    ],
    [
      "blank value",
      `${EXAMPLE_REMOTE_ORIGIN}/v1/example?value=`,
      EXAMPLE_REMOTE_ORIGIN,
    ],
    [
      "wrong path",
      `${EXAMPLE_REMOTE_ORIGIN}/v1/other?value=hello`,
      EXAMPLE_REMOTE_ORIGIN,
    ],
    [
      "embedded username/password",
      "https://user:pass@x402-worker-template.example-subdomain.workers.dev/v1/example?value=hello",
      EXAMPLE_REMOTE_ORIGIN,
    ],
    [
      "URL fragment",
      `${VALID_REMOTE_API}#fragment`,
      EXAMPLE_REMOTE_ORIGIN,
    ],
  ])("rejects %s", (_label, apiUrl, expectedRemoteApiOrigin) => {
    const result = validateApiUrl(apiUrl, expectedRemoteApiOrigin);
    expect(result.ok).toBe(false);
  });

  it.each([
    ["path", `${EXAMPLE_REMOTE_ORIGIN}/v1`],
    ["query", `${EXAMPLE_REMOTE_ORIGIN}?debug=1`],
    ["fragment", `${EXAMPLE_REMOTE_ORIGIN}#fragment`],
    ["credentials", "https://user:pass@x402-worker-template.example-subdomain.workers.dev"],
    ["HTTP", "http://x402-worker-template.example-subdomain.workers.dev"],
    ["non-workers.dev host", "https://example.com"],
  ])(
    "rejects remote origin setting containing %s",
    (_label, expectedRemoteApiOrigin) => {
      const result = validateExpectedRemoteApiOrigin(expectedRemoteApiOrigin);
      expect(result.ok).toBe(false);
    },
  );
});

describe("Base Sepolia payment policy", () => {
  it("accepts correct Base Sepolia terms", () => {
    const req = requirement({ payTo: VALID_PAY_TO });
    expect(matchesBaseSepoliaPaymentTerms(req, VALID_PAY_TO)).toBe(true);

    const filtered = applyBaseSepoliaPaymentPolicy([req], VALID_PAY_TO);
    expect(filtered).toHaveLength(1);
    expect(
      selectBaseSepoliaPaymentRequirement(2, filtered),
    ).toEqual(filtered[0]);
  });

  it("rejects Base mainnet requirement before signing", () => {
    const filtered = applyBaseSepoliaPaymentPolicy(
      [requirement({ network: "eip155:8453" as `${string}:${string}` })],
      VALID_PAY_TO,
    );
    expect(filtered).toHaveLength(0);
    expect(() =>
      selectBaseSepoliaPaymentRequirement(2, filtered),
    ).toThrow(/No payment requirement matched/i);
  });

  it("rejects another EVM testnet requirement", () => {
    const filtered = applyBaseSepoliaPaymentPolicy(
      [requirement({ network: "eip155:11155111" as `${string}:${string}` })],
      VALID_PAY_TO,
    );
    expect(filtered).toHaveLength(0);
  });

  it("rejects amount above or below 1000", () => {
    expect(
      applyBaseSepoliaPaymentPolicy(
        [requirement({ amount: "999" })],
        VALID_PAY_TO,
      ),
    ).toHaveLength(0);
    expect(
      applyBaseSepoliaPaymentPolicy(
        [requirement({ amount: "1001" })],
        VALID_PAY_TO,
      ),
    ).toHaveLength(0);
  });

  it("rejects wrong asset", () => {
    const filtered = applyBaseSepoliaPaymentPolicy(
      [
        requirement({
          asset: "0x0000000000000000000000000000000000000001",
        }),
      ],
      VALID_PAY_TO,
    );
    expect(filtered).toHaveLength(0);
    expect(filtered.some((r) => r.asset === BASE_SEPOLIA_USDC_ASSET)).toBe(
      false,
    );
  });

  it("rejects wrong payTo", () => {
    const filtered = applyBaseSepoliaPaymentPolicy(
      [
        requirement({
          payTo: "0x1111111111111111111111111111111111111111",
        }),
      ],
      VALID_PAY_TO,
    );
    expect(filtered).toHaveLength(0);
  });

  it("rejects maxTimeoutSeconds above 300", () => {
    const filtered = applyBaseSepoliaPaymentPolicy(
      [requirement({ maxTimeoutSeconds: 301 })],
      VALID_PAY_TO,
    );
    expect(filtered).toHaveLength(0);
  });

  it("rejects alternate scheme", () => {
    const filtered = applyBaseSepoliaPaymentPolicy(
      [requirement({ scheme: "upto" })],
      VALID_PAY_TO,
    );
    expect(filtered).toHaveLength(0);
  });
});
