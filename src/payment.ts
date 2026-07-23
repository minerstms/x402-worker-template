import type { FacilitatorClient, RouteConfig, RoutesConfig } from "@x402/core/server";
import { HTTPFacilitatorClient } from "@x402/core/server";
import type { Network } from "@x402/core/types";
import { ExactEvmScheme } from "@x402/evm/exact/server";
import { declareDiscoveryExtension } from "@x402/extensions/bazaar";
import {
  paymentMiddleware,
  x402ResourceServer,
} from "@x402/hono";
import type { MiddlewareHandler } from "hono";
import {
  BASE_SEPOLIA_MAX_TIMEOUT_SECONDS,
  BASE_SEPOLIA_PAYMENT_AMOUNT,
  BASE_SEPOLIA_USDC_ASSET,
  BASE_SEPOLIA_USDC_EIP712_NAME,
  BASE_SEPOLIA_USDC_EIP712_VERSION,
  isDeadPayToAddress,
  PAY_TO_PLACEHOLDER_WARNING,
  type ResolvedConfig,
} from "./config.js";
import { OPENAPI_EXAMPLE_RESPONSE } from "./openapi.js";

export type PaymentSetupOptions = {
  syncFacilitatorOnStart?: boolean;
  facilitatorClient?: FacilitatorClient;
  /** When true, use an in-memory facilitator that never contacts the network. */
  useStaticFacilitator?: boolean;
};

/**
 * Deterministic FacilitatorClient for unit tests / local unpaid-402 without
 * contacting a live facilitator. verify/settle intentionally reject.
 */
export function createStaticFacilitatorClient(
  network: string,
): FacilitatorClient {
  const kindNetwork = network as Network;
  return {
    async getSupported() {
      return {
        kinds: [
          {
            x402Version: 2,
            scheme: "exact",
            network: kindNetwork,
          },
        ],
        extensions: ["bazaar"],
        signers: {
          "eip155:*": ["0x0000000000000000000000000000000000000001"],
        },
      };
    },
    async verify() {
      return {
        isValid: false,
        invalidReason: "static_facilitator",
        invalidMessage: "Static facilitator cannot verify payments.",
      };
    },
    async settle() {
      return {
        success: false,
        errorReason: "static_facilitator",
        errorMessage: "Static facilitator cannot settle payments.",
        network: kindNetwork,
        transaction: "",
      };
    },
  };
}

export function buildExampleRouteConfig(config: ResolvedConfig): RouteConfig {
  const discovery = declareDiscoveryExtension({
    input: { value: "hello" },
    inputSchema: {
      properties: {
        value: {
          type: "string",
          description:
            "Non-blank text input. Exactly one occurrence required.",
        },
      },
      required: ["value"],
    },
    output: {
      example: OPENAPI_EXAMPLE_RESPONSE,
      schema: {
        type: "object",
        required: [
          "success",
          "input",
          "normalizedInput",
          "characterCount",
          "service",
        ],
        properties: {
          success: { type: "boolean" },
          input: { type: "string" },
          normalizedInput: { type: "string" },
          characterCount: { type: "integer" },
          service: {
            type: "object",
            properties: {
              id: { type: "string" },
              name: { type: "string" },
              retrievedAt: { type: "string", format: "date-time" },
            },
          },
        },
      },
    },
  });

  const network = config.network as Network;

  return {
    accepts: {
      scheme: "exact",
      price: {
        amount: BASE_SEPOLIA_PAYMENT_AMOUNT,
        asset: BASE_SEPOLIA_USDC_ASSET,
        extra: {
          name: BASE_SEPOLIA_USDC_EIP712_NAME,
          version: BASE_SEPOLIA_USDC_EIP712_VERSION,
        },
      },
      network,
      payTo: config.payToAddress,
      maxTimeoutSeconds: BASE_SEPOLIA_MAX_TIMEOUT_SECONDS,
    },
    description:
      "Deterministic example response echoing normalized input metadata.",
    mimeType: "application/json",
    extensions: {
      ...discovery,
    },
    unpaidResponseBody: async () => ({
      contentType: "application/json",
      body: {
        success: false,
        error: {
          code: "PAYMENT_REQUIRED",
          message: "Payment is required to access this resource.",
        },
        requestId: crypto.randomUUID(),
      },
    }),
  };
}

/**
 * Production facilitator: local supported-kind metadata for unpaid 402 construction,
 * with verify/settle delegated to the configured live HTTP facilitator.
 */
export function createProductionFacilitatorClient(
  config: ResolvedConfig,
): FacilitatorClient {
  const httpClient = new HTTPFacilitatorClient({ url: config.facilitatorUrl });
  const network = config.network as Network;

  return {
    async getSupported() {
      return {
        kinds: [
          {
            x402Version: 2,
            scheme: "exact",
            network,
          },
        ],
        extensions: ["bazaar"],
        signers: {
          [network]: ["0x0000000000000000000000000000000000000001"],
        },
      };
    },
    verify: (paymentPayload, paymentRequirements) =>
      httpClient.verify(paymentPayload, paymentRequirements),
    settle: (paymentPayload, paymentRequirements) =>
      httpClient.settle(paymentPayload, paymentRequirements),
  };
}

export function createPaymentMiddleware(
  config: ResolvedConfig,
  options: PaymentSetupOptions = {},
): MiddlewareHandler {
  if (isDeadPayToAddress(config.payToAddress)) {
    console.warn(
      JSON.stringify({
        level: "warn",
        message: PAY_TO_PLACEHOLDER_WARNING,
      }),
    );
  }

  const facilitatorClient =
    options.facilitatorClient ??
    (options.useStaticFacilitator
      ? createStaticFacilitatorClient(config.network)
      : createProductionFacilitatorClient(config));

  const network = config.network as Network;

  const resourceServer = new x402ResourceServer(facilitatorClient).register(
    network,
    new ExactEvmScheme(),
  );

  const routes: RoutesConfig = {
    "GET /v1/example": buildExampleRouteConfig(config),
  };

  const syncFacilitatorOnStart = options.syncFacilitatorOnStart ?? true;

  return paymentMiddleware(
    routes,
    resourceServer,
    undefined,
    undefined,
    syncFacilitatorOnStart,
  );
}
