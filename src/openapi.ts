import {
  DEFAULT_NETWORK,
  DEFAULT_PRICE_USD,
  SERVICE_ID,
  SERVICE_NAME,
  type ResolvedConfig,
} from "./config.js";

const EXAMPLE_RESPONSE = {
  success: true,
  input: "hello",
  normalizedInput: "hello",
  characterCount: 5,
  service: {
    id: SERVICE_ID,
    name: SERVICE_NAME,
    retrievedAt: "2026-07-21T14:00:00.000Z",
  },
};

const ERROR_SCHEMA = {
  type: "object",
  required: ["success", "error", "requestId"],
  properties: {
    success: { type: "boolean", enum: [false] },
    error: {
      type: "object",
      required: ["code", "message"],
      properties: {
        code: {
          type: "string",
          enum: [
            "MISSING_VALUE",
            "INVALID_VALUE",
            "PAYMENT_REQUIRED",
            "PAYMENT_INVALID",
            "PAYMENT_SETTLEMENT_FAILED",
            "INTERNAL_ERROR",
          ],
        },
        message: { type: "string" },
      },
    },
    requestId: { type: "string" },
  },
} as const;

export function buildOpenApiDocument(config?: Partial<ResolvedConfig>) {
  const network = config?.network ?? DEFAULT_NETWORK;
  const priceUsd = config?.priceUsd ?? DEFAULT_PRICE_USD;
  const priceAccept = config?.priceAccept ?? `$${priceUsd}`;

  return {
    openapi: "3.1.0",
    info: {
      title: SERVICE_NAME,
      version: "0.1.0",
      description:
        "Payment-verified Cloudflare Worker template using Hono and x402 v2 on Base Sepolia. Includes a deterministic example paid route for cloning.",
    },
    servers: [
      {
        url: "http://localhost:8787",
        description: "Local Wrangler dev server",
      },
    ],
    paths: {
      "/health": {
        get: {
          operationId: "getHealth",
          summary: "Liveness check",
          description: "Free health endpoint.",
          responses: {
            "200": {
              description: "Service is healthy",
              content: {
                "application/json": {
                  schema: {
                    type: "object",
                    required: ["success", "service", "status", "timestamp"],
                    properties: {
                      success: { type: "boolean", enum: [true] },
                      service: { type: "string" },
                      status: { type: "string", enum: ["healthy"] },
                      timestamp: { type: "string", format: "date-time" },
                    },
                  },
                  example: {
                    success: true,
                    service: SERVICE_NAME,
                    status: "healthy",
                    timestamp: "2026-07-21T14:00:00.000Z",
                  },
                },
              },
            },
          },
        },
      },
      "/openapi.json": {
        get: {
          operationId: "getOpenApi",
          summary: "OpenAPI document",
          description: "Free OpenAPI 3.1 document for this service.",
          responses: {
            "200": {
              description: "OpenAPI 3.1 document",
              content: {
                "application/json": {
                  schema: { type: "object" },
                },
              },
            },
          },
        },
      },
      "/v1/example": {
        get: {
          operationId: "getExample",
          summary: "Deterministic example paid route",
          description: `Requires x402 exact payment of ${priceAccept} on network ${network} (Base Sepolia). Query validation runs before payment handling.`,
          parameters: [
            {
              name: "value",
              in: "query",
              required: true,
              description:
                "Non-blank text input. Exactly one occurrence required.",
              schema: {
                type: "string",
                minLength: 1,
                maxLength: 256,
                example: "hello",
              },
            },
          ],
          responses: {
            "200": {
              description: "Example response after successful payment",
              content: {
                "application/json": {
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
                      success: { type: "boolean", enum: [true] },
                      input: { type: "string" },
                      normalizedInput: { type: "string" },
                      characterCount: { type: "integer" },
                      service: {
                        type: "object",
                        properties: {
                          id: { type: "string" },
                          name: { type: "string" },
                          retrievedAt: {
                            type: "string",
                            format: "date-time",
                          },
                        },
                      },
                    },
                  },
                  example: EXAMPLE_RESPONSE,
                },
              },
            },
            "400": {
              description: "Invalid or missing value parameter",
              content: {
                "application/json": {
                  schema: ERROR_SCHEMA,
                  examples: {
                    missingValue: {
                      value: {
                        success: false,
                        error: {
                          code: "MISSING_VALUE",
                          message: "Query parameter 'value' is required.",
                        },
                        requestId: "00000000-0000-4000-8000-000000000001",
                      },
                    },
                    invalidValue: {
                      value: {
                        success: false,
                        error: {
                          code: "INVALID_VALUE",
                          message:
                            "Query parameter 'value' must be a single non-blank string within the allowed length.",
                        },
                        requestId: "00000000-0000-4000-8000-000000000002",
                      },
                    },
                  },
                },
              },
            },
            "402": {
              description:
                "Payment required. Response includes x402 payment requirements for exact USDC on Base Sepolia.",
              content: {
                "application/json": {
                  schema: {
                    type: "object",
                    description:
                      "x402 Payment Required payload (protocol fields plus optional application error envelope).",
                    additionalProperties: true,
                    properties: {
                      x402Version: { type: "integer" },
                      error: { type: "string" },
                      accepts: {
                        type: "array",
                        items: {
                          type: "object",
                          properties: {
                            scheme: { type: "string", example: "exact" },
                            network: {
                              type: "string",
                              example: network,
                            },
                            amount: { type: "string" },
                            asset: { type: "string" },
                            payTo: { type: "string" },
                            maxTimeoutSeconds: { type: "integer" },
                          },
                        },
                      },
                      success: { type: "boolean", enum: [false] },
                      requestId: { type: "string" },
                    },
                  },
                  example: {
                    x402Version: 2,
                    error: "PAYMENT_REQUIRED",
                    accepts: [
                      {
                        scheme: "exact",
                        network,
                        price: priceAccept,
                      },
                    ],
                  },
                },
              },
            },
            "500": {
              description: "Internal error",
              content: {
                "application/json": {
                  schema: ERROR_SCHEMA,
                },
              },
            },
          },
        },
      },
    },
    components: {
      schemas: {
        ErrorBody: ERROR_SCHEMA,
        ExampleResponse: {
          type: "object",
          example: EXAMPLE_RESPONSE,
        },
      },
    },
    "x-payment": {
      priceUsd,
      priceAccept,
      network,
      networkName: "Base Sepolia",
      scheme: "exact",
      mimeType: "application/json",
    },
    "x-template-provenance":
      "Derived from x402-usgs-river-snapshot@f3d8f24 (payment-verified-base-sepolia-v1).",
  };
}

export const OPENAPI_EXAMPLE_RESPONSE = EXAMPLE_RESPONSE;
