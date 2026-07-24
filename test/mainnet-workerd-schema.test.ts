/// <reference path="../worker-configuration.mainnet.d.ts" />

import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { encodePaymentSignatureHeader } from "@x402/core/http";
import {
  declarePaymentIdentifierExtension,
  extractAndValidatePaymentIdentifier,
} from "@x402/extensions/payment-identifier";
import { unstable_dev } from "wrangler";
import { describe, expect, it, beforeEach, afterEach } from "vitest";
import { validatePaymentIdentifierBeforeReservation } from "../src/mainnet/idempotency/payment-identifier-validation.js";
import {
  extractPaymentIdentifierWithoutSchemaCompile,
  validatePaymentIdentifierExtensionWithoutSchemaCompile,
} from "../src/mainnet/idempotency/payment-identifier-workerd-safe.js";
import { validateMainnetSettlementMetadata } from "../src/mainnet/browser/mainnet-pay-settlement.js";
import {
  BASE_SEPOLIA_NETWORK,
  MAINNET_USDC_EIP712_NAME,
  MAINNET_USDC_EIP712_VERSION,
  rejectNonMainnetPaymentTerms,
} from "../src/mainnet/payment-policy.mainnet.js";
import {
  buildMatchedMainnetRequirement,
  buildTestPaymentPayload,
  buildValidMainnetPaymentPayload,
  createMainnetOrchestratorContext,
  dispatchMainnetPaidRequest,
  MAINNET_TEST_PAYMENT_ID,
  MAINNET_TEST_QUERY_VALUE,
  MAINNET_TEST_SELLER,
} from "./helpers/mainnet-orchestrator-harness.js";
import { installNetworkGuard } from "./helpers/mock-facilitator.js";

const projectRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

function buildPaymentRequiredWithSchema() {
  return {
    x402Version: 2 as const,
    resource: {
      url: `http://localhost/v1/example?value=${MAINNET_TEST_QUERY_VALUE}`,
      mimeType: "application/json",
    },
    accepts: [buildMatchedMainnetRequirement()],
    extensions: {
      "payment-identifier": declarePaymentIdentifierExtension(true),
    },
  };
}

describe("mainnet payment identifier worker-safe validation", () => {
  it("accepts valid schema-bearing payment identifier extension", () => {
    const extension = declarePaymentIdentifierExtension(true);
    extension.info.id = MAINNET_TEST_PAYMENT_ID;
    expect(validatePaymentIdentifierExtensionWithoutSchemaCompile(extension).valid).toBe(
      true,
    );
  });

  it("rejects missing payment identifier when required", async () => {
    const { deps, dispose } = await createMainnetOrchestratorContext();
    const payload = await buildTestPaymentPayload(deps, {
      omitIdentifier: true,
      includeExtensionSchema: true,
    });
    const result = validatePaymentIdentifierBeforeReservation(
      buildPaymentRequiredWithSchema(),
      payload,
    );
    expect(result.ok).toBe(false);
    await dispose();
  });

  it("rejects malformed payment identifier before reservation", async () => {
    const { deps, dispose } = await createMainnetOrchestratorContext();
    const payload = await buildTestPaymentPayload(deps, {
      malformedIdentifier: "bad",
      includeExtensionSchema: true,
    });
    const result = validatePaymentIdentifierBeforeReservation(
      buildPaymentRequiredWithSchema(),
      payload,
    );
    expect(result.ok).toBe(false);
    await dispose();
  });

  it("matches @x402/extensions validation for schema-bearing payloads in Node", async () => {
    const { deps, dispose } = await createMainnetOrchestratorContext();
    const payload = await buildTestPaymentPayload(deps, { includeExtensionSchema: true });
    const ajvPath = extractAndValidatePaymentIdentifier(payload);
    const workerdPath = extractPaymentIdentifierWithoutSchemaCompile(payload);
    expect(workerdPath.validation.valid).toBe(ajvPath.validation.valid);
    expect(workerdPath.id).toBe(ajvPath.id);
    await dispose();
  });

  it("rejects wrong network, asset, amount, seller, and EIP-712 metadata via existing policy", () => {
    const base = buildMatchedMainnetRequirement();
    expect(
      rejectNonMainnetPaymentTerms({ ...base, network: BASE_SEPOLIA_NETWORK }, MAINNET_TEST_SELLER),
    ).toContain("Sepolia");
    expect(
      rejectNonMainnetPaymentTerms(
        { ...base, asset: "0xd9aAEc86B65D86f4A9253D8C8b1c1c1c1c1c1c1c" },
        MAINNET_TEST_SELLER,
      ),
    ).toContain("Bridged");
    expect(
      rejectNonMainnetPaymentTerms({ ...base, amount: "2000" }, MAINNET_TEST_SELLER),
    ).toContain("1000 atomic units");
    expect(
      rejectNonMainnetPaymentTerms(
        { ...base, payTo: "0x2222222222222222222222222222222222222222" },
        MAINNET_TEST_SELLER,
      ),
    ).toContain("Seller address");
    expect(
      rejectNonMainnetPaymentTerms(
        { ...base, extra: { name: "USDC", version: MAINNET_USDC_EIP712_VERSION } },
        MAINNET_TEST_SELLER,
      ),
    ).toContain("USDC");
    expect(
      rejectNonMainnetPaymentTerms(
        { ...base, extra: { name: MAINNET_USDC_EIP712_NAME, version: "1" } },
        MAINNET_TEST_SELLER,
      ),
    ).toContain("version");
  });

  it("rejects invalid authorization nonce and accepts valid settlement metadata", async () => {
    const { deps, dispose } = await createMainnetOrchestratorContext();
    const invalidNonce = await buildTestPaymentPayload(deps, {
      includeExtensionSchema: true,
      authorizationOverrides: { nonce: "not-bytes32" },
    });
    const invalidRes = await dispatchMainnetPaidRequest(deps, invalidNonce);
    expect(invalidRes.status).toBe(402);

    const malformedSettlement = validateMainnetSettlementMetadata({ settlement: undefined });
    expect(malformedSettlement.ok).toBe(false);

    const validSettlement = validateMainnetSettlementMetadata({
      settlement: {
        success: true,
        transaction: `0x${"ab".repeat(32)}`,
        network: "eip155:8453",
      },
    });
    expect(validSettlement.ok).toBe(true);
    await dispose();
  });

  it("accepts schema-bearing paid orchestrator requests without AJV compile failures", async () => {
    const { deps, facilitator, dispose } = await createMainnetOrchestratorContext();
    const payload = await buildTestPaymentPayload(deps, { includeExtensionSchema: true });
    const response = await dispatchMainnetPaidRequest(deps, payload);
    expect(response.status).toBe(200);
    expect(facilitator.counts.verify).toBe(1);
    expect(facilitator.counts.settle).toBe(1);
    await dispose();
  });
});

describe("mainnet mock harness build entry", () => {
  it("uses the source entry declared in wrangler.mainnet-mock-harness.toml", () => {
    const config = readFileSync(
      path.join(projectRoot, "wrangler.mainnet-mock-harness.toml"),
      "utf8",
    );
    expect(config).toContain('main = "src/index.mainnet-mock-harness.ts"');
    expect(config).not.toContain("dist-mainnet-mock-harness/index.js");
  });

  it("builds dist-mainnet-mock-harness/index.mainnet-mock-harness.js", () => {
    const builtEntry = path.join(
      projectRoot,
      "dist-mainnet-mock-harness/index.mainnet-mock-harness.js",
    );
    expect(existsSync(builtEntry)).toBe(true);
  });
});

describe("mainnet mock harness workerd runtime", () => {
  let restoreFetch: () => void;

  beforeEach(() => {
    restoreFetch = installNetworkGuard();
  });

  afterEach(() => {
    restoreFetch();
  });

  it(
    "processes schema-bearing paid requests under wrangler dev without Error compiling schema",
    async () => {
      const worker = await unstable_dev("src/index.mainnet-mock-harness.ts", {
        config: path.join(projectRoot, "wrangler.mainnet-mock-harness.toml"),
        port: 8802,
        logLevel: "error",
        persist: false,
      });

      try {
        const payload = buildValidMainnetPaymentPayload(buildMatchedMainnetRequirement(), {
          includeExtensionSchema: true,
        });
        const response = await worker.fetch(
          `http://${worker.address}/v1/example?value=${MAINNET_TEST_QUERY_VALUE}`,
          {
            headers: {
              Accept: "application/json",
              "PAYMENT-SIGNATURE": encodePaymentSignatureHeader(payload),
            },
          },
        );
        const bodyText = await response.text();
        expect(bodyText).not.toContain("Error compiling schema");
        expect(response.status).toBe(200);
        expect(JSON.parse(bodyText)).toEqual({
          success: true,
          service: "x402 Worker Template",
          input: { value: MAINNET_TEST_QUERY_VALUE },
          output: { value: MAINNET_TEST_QUERY_VALUE },
        });
      } finally {
        await worker.stop();
      }
    },
    120_000,
  );

  it(
    "keeps production mainnet routes disabled under wrangler dev",
    async () => {
      const worker = await unstable_dev("src/index.mainnet.ts", {
        config: path.join(projectRoot, "wrangler.mainnet.toml"),
        port: 8803,
        logLevel: "error",
        persist: false,
      });

      try {
        const health = await worker.fetch(`http://${worker.address}/health`);
        expect(health.status).toBe(200);

        const status = await worker.fetch(
          `http://${worker.address}/pay/status/${MAINNET_TEST_PAYMENT_ID}`,
        );
        expect(status.status).toBe(404);

        const disabled = await worker.fetch(
          `http://${worker.address}/v1/example?value=hello`,
        );
        expect(disabled.status).toBe(503);
        expect(await disabled.text()).toContain("NOT_ENABLED");

        const mockPage = await worker.fetch(`http://${worker.address}/mock-pay`);
        expect(mockPage.status).toBe(404);
      } finally {
        await worker.stop();
      }
    },
    120_000,
  );
});
