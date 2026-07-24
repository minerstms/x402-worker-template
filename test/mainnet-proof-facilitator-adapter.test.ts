import { readFileSync } from "node:fs";
import { join } from "node:path";
import type { PaymentPayload, PaymentRequirements } from "@x402/core/types";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  MAINNET_PROOF_FACILITATOR,
  MAINNET_PROOF_FACILITATOR_MAX_RESPONSE_BYTES,
  MAINNET_PROOF_FACILITATOR_TIMEOUT_MS,
} from "../src/mainnet/proof-facilitator-candidate.mainnet.js";
import {
  PayAIProofFacilitatorAdapter,
  createProofFacilitatorCandidateHttpClient,
} from "../src/mainnet/proof-facilitator-client.mainnet.js";
import { ProofFacilitatorAdapterError } from "../src/mainnet/proof-facilitator-errors.mainnet.js";
import {
  assertFixedProofFacilitatorUrl,
  buildFixedProofFacilitatorUrl,
} from "../src/mainnet/proof-facilitator-http.mainnet.js";
import {
  buildMatchedMainnetRequirement,
  buildValidMainnetPaymentPayload,
  MAINNET_TEST_PAYMENT_ID,
} from "./helpers/mainnet-orchestrator-harness.js";
import { installNetworkGuard } from "./helpers/mock-facilitator.js";
import {
  PROOF_FACILITATOR_SETTLE_URL,
  PROOF_FACILITATOR_SUPPORTED_URL,
  PROOF_FACILITATOR_VERIFY_URL,
  countLedgerOperations,
  createProofFacilitatorMockFetch,
  ledgerEntriesForOperation,
} from "./helpers/proof-facilitator-mock-fetch.js";

const FAKE_SIGNATURE = `0x${"11".repeat(65)}`;
const FAKE_NONCE = `0x${"aa".repeat(32)}`;
const FAKE_TX = `0x${"ab".repeat(32)}`;

function buildPayload(): PaymentPayload {
  return buildValidMainnetPaymentPayload(buildMatchedMainnetRequirement());
}

function createClient(
  mockOptions: Parameters<typeof createProofFacilitatorMockFetch>[0] = {},
  timeoutMs = 50,
) {
  const mock = createProofFacilitatorMockFetch(mockOptions);
  const client = createProofFacilitatorCandidateHttpClient({
    fetchImpl: mock.fetch,
    timeoutMs,
  });
  return { client, ledger: mock.ledger, mock };
}

describe("PayAI proof facilitator adapter", () => {
  let restoreFetch: () => void;

  beforeEach(() => {
    restoreFetch = installNetworkGuard();
  });

  afterEach(() => {
    restoreFetch();
    vi.restoreAllMocks();
  });

  it("pins immutable candidate constants", () => {
    expect(MAINNET_PROOF_FACILITATOR.name).toBe("PayAI");
    expect(MAINNET_PROOF_FACILITATOR.origin).toBe("https://facilitator.payai.network");
    expect(MAINNET_PROOF_FACILITATOR_TIMEOUT_MS).toBe(10_000);
    expect(MAINNET_PROOF_FACILITATOR_MAX_RESPONSE_BYTES).toBe(256 * 1024);
  });

  it("constructs the exact-origin adapter with injected fetch", () => {
    const { client } = createClient();
    expect(client).toBeInstanceOf(PayAIProofFacilitatorAdapter);
    expect(client.url).toBe(MAINNET_PROOF_FACILITATOR.origin);
  });

  it.each([
    ["https://evil.example/verify", "/verify"],
    ["http://facilitator.payai.network/verify", "/verify"],
    ["https://user@facilitator.payai.network/verify", "/verify"],
    ["https://:secret@facilitator.payai.network/verify", "/verify"],
    ["https://facilitator.payai.network:8443/verify", "/verify"],
    ["https://facilitator.payai.network/verify#frag", "/verify"],
    ["https://facilitator.payai.network/verify?override=1", "/verify"],
    ["https://facilitator.payai.network/other", "/verify"],
  ])("rejects unsafe URL %s", (href, expectedPath) => {
    expect(() =>
      assertFixedProofFacilitatorUrl(new URL(href), expectedPath as "/verify"),
    ).toThrow(ProofFacilitatorAdapterError);
  });

  it("builds only fixed candidate URLs internally", () => {
    expect(buildFixedProofFacilitatorUrl("/supported").toString()).toBe(
      PROOF_FACILITATOR_SUPPORTED_URL,
    );
    expect(buildFixedProofFacilitatorUrl("/verify").toString()).toBe(
      PROOF_FACILITATOR_VERIFY_URL,
    );
    expect(buildFixedProofFacilitatorUrl("/settle").toString()).toBe(
      PROOF_FACILITATOR_SETTLE_URL,
    );
  });

  it("performs supported GET with exact path and no auth", async () => {
    const { client, ledger } = createClient();
    await client.getSupported();
    expect(countLedgerOperations(ledger, "supported")).toBe(1);
    const entry = ledgerEntriesForOperation(ledger, "supported")[0]!;
    expect(entry.method).toBe("GET");
    expect(entry.path).toBe("/supported");
    expect(entry.hasAuthorizationHeader).toBe(false);
    expect(entry.redirectDisabled).toBe(true);
  });

  it("performs verify POST with wrapper shape and no auth", async () => {
    const requirement = buildMatchedMainnetRequirement();
    const payload = buildPayload();
    let capturedBody: Record<string, unknown> | undefined;
    const mock = createProofFacilitatorMockFetch({
      verifyResponse: { isValid: true, payer: "0x1111111111111111111111111111111111111111" },
    });
    const originalFetch = mock.fetch;
    mock.fetch = (async (input, init) => {
      if (String(input).includes("/verify")) {
        capturedBody = JSON.parse(String(init?.body));
      }
      return originalFetch(input, init);
    }) as typeof fetch;
    const client = createProofFacilitatorCandidateHttpClient({
      fetchImpl: mock.fetch,
      timeoutMs: 50,
    });
    await client.verify(payload, requirement);
    expect(capturedBody).toEqual({
      x402Version: payload.x402Version,
      paymentPayload: payload,
      paymentRequirements: requirement,
    });
    const entry = ledgerEntriesForOperation(mock.ledger, "verify")[0]!;
    expect(entry.method).toBe("POST");
    expect(entry.path).toBe("/verify");
    expect(entry.requestContentType).toBe("application/json");
    expect(entry.hasAuthorizationHeader).toBe(false);
  });

  it("performs settle POST with wrapper shape and no auth", async () => {
    const { client, ledger } = createClient();
    await client.settle(buildPayload(), buildMatchedMainnetRequirement());
    const entry = ledgerEntriesForOperation(ledger, "settle")[0]!;
    expect(entry.method).toBe("POST");
    expect(entry.path).toBe("/settle");
    expect(entry.hasAuthorizationHeader).toBe(false);
  });

  it("rejects redirect responses", async () => {
    const { client } = createClient({ supportedMode: "redirect" });
    await expect(client.getSupported()).rejects.toMatchObject({
      category: "network",
    });
  });

  it("sanitizes network failures", async () => {
    const { client } = createClient({ verifyResponse: "throw-network" });
    await expect(
      client.verify(buildPayload(), buildMatchedMainnetRequirement()),
    ).rejects.toMatchObject({
      category: "network",
      message: "Facilitator network request failed.",
    });
  });

  it("sanitizes timeouts", async () => {
    const { client } = createClient({ verifyResponse: "throw-timeout" });
    await expect(
      client.verify(buildPayload(), buildMatchedMainnetRequirement()),
    ).rejects.toMatchObject({
      category: "timeout",
    });
  });

  it("rejects missing JSON content type", async () => {
    const { client } = createClient({ supportedMode: "missing-content-type" });
    await expect(client.getSupported()).rejects.toMatchObject({
      category: "content-type",
    });
  });

  it("rejects HTML responses", async () => {
    const { client } = createClient({ supportedMode: "html" });
    await expect(client.getSupported()).rejects.toMatchObject({
      category: "content-type",
    });
  });

  it("rejects invalid JSON", async () => {
    const { client } = createClient({ supportedMode: "invalid-json" });
    await expect(client.getSupported()).rejects.toMatchObject({
      category: "invalid-json",
    });
  });

  it("rejects oversized declared bodies", async () => {
    const { client } = createClient({ supportedMode: "oversized-content-length" });
    await expect(client.getSupported()).rejects.toMatchObject({
      category: "oversized-body",
    });
  });

  it("rejects oversized streamed bodies", async () => {
    const { client } = createClient({ supportedMode: "oversized-stream" });
    await expect(client.getSupported()).rejects.toMatchObject({
      category: "oversized-body",
    });
  });

  it("bounds dishonest content-length while streaming", async () => {
    const { client } = createClient({ supportedMode: "dishonest-content-length" });
    await expect(client.getSupported()).rejects.toMatchObject({
      category: "oversized-body",
    });
  });

  it("validates supported responses through installed-shaped schema", async () => {
    const { client } = createClient({
      supportedResponse: { kinds: "invalid" } as never,
    });
    await expect(client.getSupported()).rejects.toMatchObject({ category: "schema" });
  });

  it("validates verify responses through installed-shaped schema", async () => {
    const { client } = createClient({
      verifyResponse: { isValid: "yes" } as never,
    });
    await expect(
      client.verify(buildPayload(), buildMatchedMainnetRequirement()),
    ).rejects.toMatchObject({ category: "schema" });
  });

  it("validates settle responses through installed-shaped schema", async () => {
    const { client } = createClient({
      settleResponse: { success: "yes", transaction: FAKE_TX, network: "eip155:8453" } as never,
    });
    await expect(
      client.settle(buildPayload(), buildMatchedMainnetRequirement()),
    ).rejects.toMatchObject({ category: "schema" });
  });

  it("does not retry verify on HTTP 429", async () => {
    const { client, ledger } = createClient({ verifyResponse: "http-429" });
    await expect(
      client.verify(buildPayload(), buildMatchedMainnetRequirement()),
    ).rejects.toBeTruthy();
    expect(countLedgerOperations(ledger, "verify")).toBe(1);
  });

  it("does not retry verify on HTTP 500", async () => {
    const { client, ledger } = createClient({ verifyResponse: "http-500" });
    await expect(
      client.verify(buildPayload(), buildMatchedMainnetRequirement()),
    ).rejects.toBeTruthy();
    expect(countLedgerOperations(ledger, "verify")).toBe(1);
  });

  it("does not retry getSupported on HTTP 429", async () => {
    const { client, ledger } = createClient({ supportedMode: "http-429" });
    await expect(client.getSupported()).rejects.toBeTruthy();
    expect(countLedgerOperations(ledger, "supported")).toBe(1);
  });

  it("does not log sensitive payment material", async () => {
    const logSpy = vi.spyOn(console, "log").mockImplementation(() => undefined);
    const errorSpy = vi.spyOn(console, "error").mockImplementation(() => undefined);
    const payload = buildValidMainnetPaymentPayload(buildMatchedMainnetRequirement(), {
      paymentIdentifier: MAINNET_TEST_PAYMENT_ID,
      authorizationOverrides: { nonce: FAKE_NONCE },
    });
    const { client } = createClient({ transactionHash: FAKE_TX });
    await client.verify(payload, buildMatchedMainnetRequirement());
    await client.settle(payload, buildMatchedMainnetRequirement());
    const combined = [...logSpy.mock.calls, ...errorSpy.mock.calls]
      .flat()
      .map((entry) => String(entry))
      .join("\n");
    expect(combined).not.toContain(MAINNET_TEST_PAYMENT_ID);
    expect(combined).not.toContain(FAKE_SIGNATURE);
    expect(combined).not.toContain(FAKE_NONCE);
    expect(combined).not.toContain(FAKE_TX);
  });

  it("does not expose raw dependency error messages", async () => {
    const { client } = createClient({ verifyResponse: "throw-network" });
    await expect(
      client.verify(buildPayload(), buildMatchedMainnetRequirement()),
    ).rejects.not.toThrow(/mock network failure/);
  });

  it("keeps adapter source free of authentication configuration", () => {
    const clientSource = readRepoFile("src/mainnet/proof-facilitator-client.mainnet.ts");
    const httpSource = readRepoFile("src/mainnet/proof-facilitator-http.mainnet.ts");
    for (const source of [clientSource, httpSource]) {
      expect(source).not.toContain("createAuthHeaders");
      expect(source).not.toContain("Authorization");
      expect(source).not.toContain("Bearer ");
      expect(source).not.toMatch(/api[_-]?key/i);
    }
  });
});

function readRepoFile(relativePath: string): string {
  return readFileSync(join(import.meta.dirname, "..", relativePath), "utf8");
}
