import {
  x402ResourceServer,
  type FacilitatorClient,
} from "@x402/core/server";
import {
  decodePaymentSignatureHeader,
  encodePaymentRequiredHeader,
  encodePaymentResponseHeader,
} from "@x402/core/http";
import type { PaymentPayload, PaymentRequired } from "@x402/core/types";
import { ExactEvmScheme } from "@x402/evm/exact/server";
import { isValidExampleValue } from "../../routes/example.js";
import {
  coordinatorAcquireSettleLease,
  coordinatorAcquireVerifyLease,
  coordinatorCompleteFulfillment,
  coordinatorCompleteVerify,
  coordinatorFailDefinitive,
  coordinatorGetReplay,
  coordinatorMarkSettleUncertain,
  coordinatorMarkVerifyUncertain,
  coordinatorPrepareAttempt,
  coordinatorStageResponse,
} from "../durable/payment-coordinator-client.js";
import type { LeaseAcquireResult } from "../durable/payment-attempt-types.js";
import {
  ALLOWED_STAGED_CONTENT_TYPE,
  STAGED_RESPONSE_MAX_BYTES,
} from "../mainnet-config.js";
import {
  buildMainnetExamplePaymentOption,
  buildMainnetExampleResourceInfo,
  buildMainnetExampleResponse,
  buildMainnetExampleRouteConfig,
} from "../payment.mainnet.js";
import type { MainnetPolicyConfig } from "../payment-policy.mainnet.js";
import {
  MAINNET_PAID_QUERY_KEY,
  MAINNET_PAID_ROUTE,
  validateBaseMainnetPaymentRequirements,
} from "../payment-policy.mainnet.js";
import {
  buildAuthCommitment,
  buildRecordKey,
  buildResourceIdentityHash,
  buildTermsFingerprint,
} from "./canonical-keys.js";
import {
  fulfilledReplayToHttpResponse,
  type FulfilledReplayResult,
} from "./replay-response.js";
import { validateEip3009AuthorizationStructure } from "./eip3009-authorization.js";
import { validatePaymentIdentifierBeforeReservation } from "./payment-identifier-validation.js";
import { validateSettlementReceiptForStorage } from "./settlement-receipt.js";

const LOCAL_COMPLETION_RETRY_LIMIT = 3;

export type MainnetOrchestratorDeps = {
  coordinator: DurableObjectNamespace;
  facilitator: FacilitatorClient;
  policy: MainnetPolicyConfig;
  resourceServer?: x402ResourceServer;
  buildResponse?: (value: string) => Record<string, unknown>;
};

export type MainnetOrchestratorRequest = {
  method: string;
  url: URL;
  paymentSignatureHeader?: string | null;
  decodePaymentPayload?: (header: string) => PaymentPayload;
};

export type MainnetOrchestratorContext = {
  request: MainnetOrchestratorRequest;
  deps: MainnetOrchestratorDeps;
};

function jsonResponse(
  body: unknown,
  status: number,
  headers: Record<string, string> = {},
): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: {
      "Content-Type": "application/json",
      "Cache-Control": "no-store",
      ...headers,
    },
  });
}

function paymentRequiredResponse(
  paymentRequired: PaymentRequired,
  status = 402,
): Response {
  return jsonResponse(paymentRequired, status, {
    "PAYMENT-REQUIRED": encodePaymentRequiredHeader(paymentRequired),
  });
}

function inProgressResponse(paymentIdentifier: string): Response {
  return jsonResponse(
    {
      success: false,
      error: {
        code: "PAYMENT_IN_PROGRESS",
        message:
          "Payment is being processed. Poll /pay/status/:paymentIdentifier for updates.",
        paymentIdentifier,
      },
    },
    202,
  );
}

function uncertainResponse(paymentIdentifier: string): Response {
  return jsonResponse(
    {
      success: false,
      error: {
        code: "PAYMENT_UNCERTAIN",
        message:
          "Payment outcome is uncertain. Poll /pay/status/:paymentIdentifier for updates.",
        paymentIdentifier,
        canRetry: false,
      },
    },
    503,
  );
}

function conflictResponse(reason: string): Response {
  return jsonResponse(
    {
      success: false,
      error: {
        code: "PAYMENT_CONFLICT",
        message: reason,
      },
    },
    409,
  );
}

function invalidQueryResponse(): Response {
  return jsonResponse(
    {
      success: false,
      error: {
        code: "INVALID_QUERY",
        message: "Query must contain exactly one valid value parameter.",
      },
    },
    400,
  );
}

export function validateMainnetExampleQuery(url: URL): string | null {
  const queryKeys = [...url.searchParams.keys()];
  if (queryKeys.length !== 1 || queryKeys[0] !== MAINNET_PAID_QUERY_KEY) {
    return null;
  }
  const values = url.searchParams.getAll(MAINNET_PAID_QUERY_KEY);
  if (values.length !== 1) {
    return null;
  }
  const value = values[0]!;
  if (!isValidExampleValue(value)) {
    return null;
  }
  return value;
}

export function createMainnetOrchestratorResourceServer(
  facilitator: FacilitatorClient,
): x402ResourceServer {
  return new x402ResourceServer(facilitator).register(
    "eip155:8453",
    new ExactEvmScheme(),
  );
}

export function buildMainnetHttpContext(url: string, method = "GET") {
  const parsed = new URL(url);
  return {
    method,
    path: parsed.pathname,
    adapter: {
      getMethod: () => method,
      getUrl: () => url,
      getPath: () => parsed.pathname,
      getHeader: () => undefined,
      getAcceptHeader: () => "application/json",
      getUserAgent: () => "mainnet-orchestrator-harness",
    },
  };
}

async function buildServerPaymentRequired(
  ctx: MainnetOrchestratorContext,
  value: string,
  error?: string,
  paymentPayload?: PaymentPayload,
): Promise<PaymentRequired> {
  const { deps } = ctx;
  const resourceServer =
    deps.resourceServer ?? createMainnetOrchestratorResourceServer(deps.facilitator);
  const routeConfig = buildMainnetExampleRouteConfig(deps.policy);
  const paymentOptions = [buildMainnetExamplePaymentOption(deps.policy)];
  const requestUrl = `${ctx.request.url.origin}${MAINNET_PAID_ROUTE}?${MAINNET_PAID_QUERY_KEY}=${encodeURIComponent(value)}`;
  const httpContext = buildMainnetHttpContext(requestUrl, ctx.request.method);
  const requirements = await resourceServer.buildPaymentRequirementsFromOptions(
    paymentOptions,
    httpContext,
  );
  const terms = validateBaseMainnetPaymentRequirements(
    requirements,
    deps.policy.sellerAddress,
  );
  if (!terms.ok) {
    throw new Error(terms.reason);
  }
  return resourceServer.createPaymentRequiredResponse(
    requirements,
    buildMainnetExampleResourceInfo(
      `${ctx.request.url.origin}${MAINNET_PAID_ROUTE}?${MAINNET_PAID_QUERY_KEY}=${encodeURIComponent(value)}`,
    ),
    error,
    routeConfig.extensions,
    httpContext,
    paymentPayload,
  );
}

async function buildPaymentErrorFromRequired(
  ctx: MainnetOrchestratorContext,
  value: string,
  error: string,
  paymentPayload?: PaymentPayload,
): Promise<Response> {
  const paymentRequired = await buildServerPaymentRequired(
    ctx,
    value,
    error,
    paymentPayload,
  );
  return paymentRequiredResponse(paymentRequired);
}

function normalizeQueryRecord(url: URL, value: string): Record<string, string> {
  return { [MAINNET_PAID_QUERY_KEY]: value };
}

async function computeCanonicalKeys(
  matchedRequirement: PaymentRequired["accepts"][number],
  authorization: {
    from: string;
    to: string;
    value: string;
    validAfter: string;
    validBefore: string;
    nonce: string;
  },
  value: string,
) {
  const normalizedQuery = normalizeQueryRecord(new URL("http://local/v1/example"), value);
  const termsFingerprint = await buildTermsFingerprint({
    scheme: matchedRequirement.scheme,
    network: matchedRequirement.network,
    asset: matchedRequirement.asset,
    amount: matchedRequirement.amount,
    payTo: matchedRequirement.payTo,
    httpMethod: "GET",
    normalizedRoute: MAINNET_PAID_ROUTE,
    normalizedQuery,
  });
  const authCommitment = await buildAuthCommitment({
    network: matchedRequirement.network,
    from: authorization.from,
    authorizationNonce: authorization.nonce,
    to: authorization.to,
    value: authorization.value,
    validAfter: authorization.validAfter,
    validBefore: authorization.validBefore,
    verifyingContract: matchedRequirement.asset,
  });
  const resourceIdentityHash = await buildResourceIdentityHash({
    httpMethod: "GET",
    normalizedRoute: MAINNET_PAID_ROUTE,
    normalizedQuery,
  });
  return { termsFingerprint, authCommitment, resourceIdentityHash };
}

async function sanitizeCancel(
  cancel: { cancel: (options: { reason: "handler_failed" | "after_verify_aborted" | "handler_threw"; error?: unknown }) => Promise<void> } | null,
  reason: "handler_failed" | "after_verify_aborted" | "handler_threw",
  error?: unknown,
): Promise<void> {
  if (!cancel) {
    return;
  }
  try {
    await cancel.cancel({ reason, error });
  } catch {
    // Cancellation failures are sanitized.
  }
}

async function completeFulfillmentWithRetries(
  coordinator: DurableObjectNamespace,
  params: {
    recordKey: string;
    operationGeneration: number;
    operationToken: string;
    settlementReceipt: unknown;
  },
): Promise<{ ok: true } | { ok: false; attempts: number }> {
  for (let attempt = 0; attempt < LOCAL_COMPLETION_RETRY_LIMIT; attempt += 1) {
    const result = await coordinatorCompleteFulfillment(coordinator, params);
    if (result.kind === "completed") {
      return { ok: true };
    }
  }
  return { ok: false, attempts: LOCAL_COMPLETION_RETRY_LIMIT };
}

export async function handleMainnetExampleUnpaidRequest(
  ctx: MainnetOrchestratorContext,
): Promise<Response> {
  if (ctx.request.method.toUpperCase() !== "GET") {
    return jsonResponse({ success: false, error: { code: "METHOD_NOT_ALLOWED" } }, 405);
  }
  const value = validateMainnetExampleQuery(ctx.request.url);
  if (!value) {
    return invalidQueryResponse();
  }
  const paymentRequired = await buildServerPaymentRequired(ctx, value);
  const terms = validateBaseMainnetPaymentRequirements(
    paymentRequired.accepts,
    ctx.deps.policy.sellerAddress,
  );
  if (!terms.ok) {
    return jsonResponse({ success: false, error: { code: "POLICY_ERROR", message: terms.reason } }, 500);
  }
  return paymentRequiredResponse(paymentRequired);
}

export async function handleMainnetExamplePaidRequest(
  ctx: MainnetOrchestratorContext,
): Promise<Response> {
  if (ctx.request.method.toUpperCase() !== "GET") {
    return jsonResponse({ success: false, error: { code: "METHOD_NOT_ALLOWED" } }, 405);
  }

  const value = validateMainnetExampleQuery(ctx.request.url);
  if (!value) {
    return invalidQueryResponse();
  }

  const paymentHeader = ctx.request.paymentSignatureHeader?.trim();
  if (!paymentHeader) {
    return handleMainnetExampleUnpaidRequest(ctx);
  }

  let paymentPayload: PaymentPayload;
  try {
    const decode = ctx.request.decodePaymentPayload ?? decodePaymentSignatureHeader;
    paymentPayload = decode(paymentHeader);
  } catch {
    return buildPaymentErrorFromRequired(
      ctx,
      value,
      "Malformed payment payload.",
    );
  }

  const { deps } = ctx;
  const resourceServer =
    deps.resourceServer ?? createMainnetOrchestratorResourceServer(deps.facilitator);
  const routeConfig = buildMainnetExampleRouteConfig(deps.policy);
  const paymentOptions = [buildMainnetExamplePaymentOption(deps.policy)];
  const requestUrl = `${ctx.request.url.origin}${MAINNET_PAID_ROUTE}?${MAINNET_PAID_QUERY_KEY}=${encodeURIComponent(value)}`;
  const httpContext = buildMainnetHttpContext(requestUrl, ctx.request.method);

  const requirements = await resourceServer.buildPaymentRequirementsFromOptions(
    paymentOptions,
    httpContext,
  );
  const termsValidation = validateBaseMainnetPaymentRequirements(
    requirements,
    deps.policy.sellerAddress,
  );
  if (!termsValidation.ok) {
    return buildPaymentErrorFromRequired(
      ctx,
      value,
      termsValidation.reason,
      paymentPayload,
    );
  }

  const paymentRequired = await resourceServer.createPaymentRequiredResponse(
    requirements,
    buildMainnetExampleResourceInfo(ctx.request.url.toString()),
    undefined,
    routeConfig.extensions,
    httpContext,
  );

  const matchedRequirement = resourceServer.findMatchingRequirements(
    paymentRequired.accepts,
    paymentPayload,
  );
  if (!matchedRequirement) {
    return buildPaymentErrorFromRequired(
      ctx,
      value,
      "No matching payment requirements.",
      paymentPayload,
    );
  }

  const extensionResult = resourceServer.validateExtensions(
    paymentRequired,
    paymentPayload,
  );
  if (!extensionResult.valid) {
    return buildPaymentErrorFromRequired(
      ctx,
      value,
      extensionResult.invalidReason ?? "Extension validation failed.",
      paymentPayload,
    );
  }

  const identifierResult = validatePaymentIdentifierBeforeReservation(
    paymentRequired,
    paymentPayload,
  );
  if (!identifierResult.ok) {
    return buildPaymentErrorFromRequired(
      ctx,
      value,
      identifierResult.reason,
      paymentPayload,
    );
  }

  const authorizationResult = validateEip3009AuthorizationStructure(
    paymentPayload,
    matchedRequirement,
  );
  if (!authorizationResult.ok) {
    return buildPaymentErrorFromRequired(
      ctx,
      value,
      authorizationResult.reason,
      paymentPayload,
    );
  }

  const paymentIdentifier = identifierResult.paymentIdentifier;
  const canonical = await computeCanonicalKeys(
    matchedRequirement,
    authorizationResult.authorization,
    value,
  );
  const recordKey = await buildRecordKey(
    paymentIdentifier,
    canonical.termsFingerprint,
  );

  const prepareResult = await coordinatorPrepareAttempt(deps.coordinator, {
    paymentIdentifier,
    termsFingerprint: canonical.termsFingerprint,
    authCommitment: canonical.authCommitment,
    resourceIdentityHash: canonical.resourceIdentityHash,
    authorizationNonce: authorizationResult.authorization.nonce,
    network: matchedRequirement.network,
    asset: matchedRequirement.asset,
    amount: matchedRequirement.amount,
  });

  if (prepareResult.kind === "conflict") {
    return conflictResponse(prepareResult.reason);
  }
  if (prepareResult.kind === "replay") {
    const replay = (await coordinatorGetReplay(
      deps.coordinator,
      prepareResult.recordKey,
    )) as FulfilledReplayResult;
    if (replay.ok) {
      return fulfilledReplayToHttpResponse(replay);
    }
    return uncertainResponse(paymentIdentifier);
  }
  if (prepareResult.kind === "failed") {
    return buildPaymentErrorFromRequired(
      ctx,
      value,
      "Payment attempt previously failed.",
      paymentPayload,
    );
  }
  if (prepareResult.kind === "uncertain") {
    return uncertainResponse(paymentIdentifier);
  }
  if (prepareResult.kind === "wait") {
    return inProgressResponse(paymentIdentifier);
  }

  const verifyLease = await coordinatorAcquireVerifyLease(deps.coordinator, {
    recordKey,
  });
  if (verifyLease.kind !== "acquired") {
    return inProgressResponse(paymentIdentifier);
  }

  let cancellationDispatcher: ReturnType<
    x402ResourceServer["createPaymentCancellationDispatcher"]
  > | null = null;

  try {
    const verifyResult = await resourceServer.verifyPayment(
      paymentPayload,
      matchedRequirement,
      routeConfig.extensions,
      httpContext,
    );

    if (!verifyResult.isValid) {
      await coordinatorFailDefinitive(deps.coordinator, {
        recordKey,
        failureCategory: verifyResult.invalidReason ?? "verify_invalid",
      });
      return buildPaymentErrorFromRequired(
        ctx,
        value,
        verifyResult.invalidReason ?? "Payment verification failed.",
        paymentPayload,
      );
    }

    const completeVerify = await coordinatorCompleteVerify(deps.coordinator, {
      recordKey,
      operationGeneration: verifyLease.operationGeneration,
      operationToken: verifyLease.operationToken,
    });
    if (completeVerify.kind !== "completed") {
      return uncertainResponse(paymentIdentifier);
    }

    cancellationDispatcher = resourceServer.createPaymentCancellationDispatcher(
      paymentPayload,
      matchedRequirement,
      routeConfig.extensions,
      httpContext,
    );

    const buildResponse = deps.buildResponse ?? buildMainnetExampleResponse;
    let responseBody: Record<string, unknown>;
    try {
      responseBody = buildResponse(value);
    } catch (error) {
      await sanitizeCancel(cancellationDispatcher, "handler_failed", error);
      await coordinatorFailDefinitive(deps.coordinator, {
        recordKey,
        failureCategory: "response_construction_failed",
      });
      return buildPaymentErrorFromRequired(
        ctx,
        value,
        "Unable to construct paid response.",
        paymentPayload,
      );
    }

    const bodyJson = JSON.stringify(responseBody);
    if (new TextEncoder().encode(bodyJson).byteLength > STAGED_RESPONSE_MAX_BYTES) {
      await sanitizeCancel(cancellationDispatcher, "handler_failed");
      await coordinatorFailDefinitive(deps.coordinator, {
        recordKey,
        failureCategory: "response_too_large",
      });
      return buildPaymentErrorFromRequired(
        ctx,
        value,
        "Paid response exceeds staging limit.",
        paymentPayload,
      );
    }

    const staged = await coordinatorStageResponse(deps.coordinator, {
      recordKey,
      body: bodyJson,
      contentType: ALLOWED_STAGED_CONTENT_TYPE,
    });
    if (staged.kind !== "staged") {
      await sanitizeCancel(cancellationDispatcher, "after_verify_aborted");
      await coordinatorFailDefinitive(deps.coordinator, {
        recordKey,
        failureCategory: "stage_response_failed",
      });
      return buildPaymentErrorFromRequired(
        ctx,
        value,
        "Unable to stage paid response.",
        paymentPayload,
      );
    }

    const settleLease = await acquireSettleLeaseOrWait(
      deps.coordinator,
      recordKey,
      paymentIdentifier,
    );
    if (settleLease.kind !== "acquired") {
      return settleLease.response;
    }

    let settleResponse;
    try {
      settleResponse = await resourceServer.settlePayment(
        paymentPayload,
        matchedRequirement,
        routeConfig.extensions,
        httpContext,
      );
    } catch {
      await coordinatorMarkSettleUncertain(deps.coordinator, {
        recordKey,
        operationGeneration: settleLease.operationGeneration,
        operationToken: settleLease.operationToken,
      });
      return uncertainResponse(paymentIdentifier);
    }

    if (!settleResponse.success) {
      await sanitizeCancel(cancellationDispatcher, "after_verify_aborted");
      await coordinatorFailDefinitive(deps.coordinator, {
        recordKey,
        failureCategory: settleResponse.errorReason ?? "settle_failed",
      });
      return buildPaymentErrorFromRequired(
        ctx,
        value,
        settleResponse.errorReason ?? "Settlement failed.",
        paymentPayload,
      );
    }

    const receiptValidation = validateSettlementReceiptForStorage(settleResponse);
    if (!receiptValidation.ok) {
      await sanitizeCancel(cancellationDispatcher, "after_verify_aborted");
      await coordinatorMarkSettleUncertain(deps.coordinator, {
        recordKey,
        operationGeneration: settleLease.operationGeneration,
        operationToken: settleLease.operationToken,
      });
      return uncertainResponse(paymentIdentifier);
    }

    const completion = await completeFulfillmentWithRetries(deps.coordinator, {
      recordKey,
      operationGeneration: settleLease.operationGeneration,
      operationToken: settleLease.operationToken,
      settlementReceipt: receiptValidation.receipt,
    });

    const paymentResponseHeader = encodePaymentResponseHeader(settleResponse);
    if (completion.ok) {
      return jsonResponse(responseBody, 200, {
        "PAYMENT-RESPONSE": paymentResponseHeader,
      });
    }

    await coordinatorMarkSettleUncertain(deps.coordinator, {
      recordKey,
      operationGeneration: settleLease.operationGeneration,
      operationToken: settleLease.operationToken,
    });

    return jsonResponse(responseBody, 200, {
      "PAYMENT-RESPONSE": paymentResponseHeader,
    });
  } catch {
    await coordinatorMarkVerifyUncertain(deps.coordinator, {
      recordKey,
      operationGeneration: verifyLease.operationGeneration,
      operationToken: verifyLease.operationToken,
    });
    return uncertainResponse(paymentIdentifier);
  }
}

async function acquireSettleLeaseOrWait(
  coordinator: DurableObjectNamespace,
  recordKey: string,
  paymentIdentifier: string,
): Promise<
  | (LeaseAcquireResult & { kind: "acquired" })
  | { kind: "wait"; response: Response }
> {
  const settleLease = await coordinatorAcquireSettleLease(coordinator, {
    recordKey,
  });
  if (settleLease.kind === "acquired") {
    return settleLease;
  }
  return {
    kind: "wait",
    response: inProgressResponse(paymentIdentifier),
  };
}

export async function handleMainnetExampleRequest(
  ctx: MainnetOrchestratorContext,
): Promise<Response> {
  if (ctx.request.paymentSignatureHeader?.trim()) {
    return handleMainnetExamplePaidRequest(ctx);
  }
  return handleMainnetExampleUnpaidRequest(ctx);
}
