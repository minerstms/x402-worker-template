import { encodePaymentSignatureHeader } from "@x402/core/http";
import type { PaymentPayload, PaymentRequirements } from "@x402/core/types";
import { PAYMENT_IDENTIFIER } from "@x402/extensions/payment-identifier";
import {
  buildMainnetHttpContext,
  createMainnetOrchestratorResourceServer,
  handleMainnetExampleRequest,
  type MainnetOrchestratorContext,
  type MainnetOrchestratorDeps,
} from "../../src/mainnet/idempotency/mainnet-payment-orchestrator.js";
import {
  buildMainnetExamplePaymentOption,
} from "../../src/mainnet/payment.mainnet.js";
import type { MainnetPolicyConfig } from "../../src/mainnet/payment-policy.mainnet.js";
import {
  createMainnetTestContext,
  type MainnetTestBindings,
} from "./mainnet-coordinator-harness.js";
import {
  createMockFacilitatorClient,
  type MockFacilitatorOptions,
} from "./mock-facilitator.js";

export const MAINNET_TEST_SELLER = "0x000000000000000000000000000000000000dEaD";
export const MAINNET_TEST_PAYMENT_ID = "pay_7d5d747be160e280";
export const MAINNET_TEST_QUERY_VALUE = "hello";

const FAKE_SIGNATURE = `0x${"11".repeat(65)}`;

export function buildMatchedMainnetRequirement(
  sellerAddress = MAINNET_TEST_SELLER,
): PaymentRequirements {
  return {
    scheme: "exact",
    network: "eip155:8453",
    amount: "1000",
    asset: "0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913",
    payTo: sellerAddress,
    maxTimeoutSeconds: 300,
    extra: {
      name: "USD Coin",
      version: "2",
    },
  };
}

export async function buildServerMainnetRequirement(
  deps: MainnetOrchestratorDeps,
  value = MAINNET_TEST_QUERY_VALUE,
): Promise<PaymentRequirements> {
  const resourceServer =
    deps.resourceServer ?? createMainnetOrchestratorResourceServer(deps.facilitator);
  const [requirement] = await resourceServer.buildPaymentRequirementsFromOptions(
    [buildMainnetExamplePaymentOption(deps.policy)],
    buildMainnetHttpContext(
      `http://localhost/v1/example?value=${encodeURIComponent(value)}`,
    ),
  );
  return requirement!;
}

export function buildValidMainnetPaymentPayload(
  acceptedRequirement: PaymentRequirements,
  overrides: {
    paymentIdentifier?: string;
    authorizationOverrides?: Partial<{
      from: string;
      to: string;
      value: string;
      validAfter: string;
      validBefore: string;
      nonce: string;
    }>;
    omitIdentifier?: boolean;
    malformedIdentifier?: string;
  } = {},
): PaymentPayload {
  const authorization = {
    from: "0x1111111111111111111111111111111111111111",
    to: acceptedRequirement.payTo,
    value: acceptedRequirement.amount,
    validAfter: "0",
    validBefore: "9999999999",
    nonce: `0x${"aa".repeat(32)}`,
    ...overrides.authorizationOverrides,
  };

  const payload: PaymentPayload = {
    x402Version: 2,
    accepted: acceptedRequirement,
    payload: {
      authorization,
      signature: FAKE_SIGNATURE,
    },
  };

  if (!overrides.omitIdentifier) {
    payload.extensions = {
      [PAYMENT_IDENTIFIER]: {
        info: {
          required: true,
          id: overrides.malformedIdentifier ?? overrides.paymentIdentifier ?? MAINNET_TEST_PAYMENT_ID,
        },
      },
    };
  }

  return payload;
}

export async function buildTestPaymentPayload(
  deps: MainnetOrchestratorDeps,
  options: {
    value?: string;
    paymentIdentifier?: string;
    acceptedOverrides?: Partial<PaymentRequirements>;
    authorizationOverrides?: Partial<{
      from: string;
      to: string;
      value: string;
      validAfter: string;
      validBefore: string;
      nonce: string;
    }>;
    omitIdentifier?: boolean;
    malformedIdentifier?: string;
  } = {},
): Promise<PaymentPayload> {
  const accepted = {
    ...(await buildServerMainnetRequirement(deps, options.value)),
    ...options.acceptedOverrides,
  };
  return buildValidMainnetPaymentPayload(accepted, {
    paymentIdentifier: options.paymentIdentifier,
    authorizationOverrides: options.authorizationOverrides,
    omitIdentifier: options.omitIdentifier,
    malformedIdentifier: options.malformedIdentifier,
  });
}

export function buildMainnetExampleRequestUrl(value = MAINNET_TEST_QUERY_VALUE): URL {
  return new URL(`http://localhost/v1/example?value=${encodeURIComponent(value)}`);
}

export async function createMainnetOrchestratorContext(
  options: {
    facilitator?: MockFacilitatorOptions;
    sellerAddress?: string;
    bindings?: MainnetTestBindings;
    buildResponse?: MainnetOrchestratorDeps["buildResponse"];
  } = {},
): Promise<{
  bindings: MainnetTestBindings;
  deps: MainnetOrchestratorDeps;
  facilitator: ReturnType<typeof createMockFacilitatorClient>;
  dispose: () => Promise<void>;
}> {
  const facilitator = createMockFacilitatorClient(options.facilitator);
  const policy: MainnetPolicyConfig = {
    sellerAddress: options.sellerAddress ?? MAINNET_TEST_SELLER,
  };
  let bindings = options.bindings;
  let dispose: () => Promise<void> = async () => undefined;
  if (!bindings) {
    const context = await createMainnetTestContext();
    bindings = context.bindings;
    dispose = async () => {
      await context.mf.dispose();
    };
  }
  const resourceServer = createMainnetOrchestratorResourceServer(facilitator);
  await resourceServer.initialize();
  const deps: MainnetOrchestratorDeps = {
    coordinator: bindings.PAYMENT_COORDINATOR,
    facilitator,
    policy,
    resourceServer,
    buildResponse: options.buildResponse,
  };
  return { bindings, deps, facilitator, dispose };
}

export async function dispatchMainnetOrchestratorRequest(
  deps: MainnetOrchestratorDeps,
  init: {
    url?: URL;
    paymentPayload?: PaymentPayload;
    paymentSignatureHeader?: string | null;
  } = {},
): Promise<Response> {
  const url = init.url ?? buildMainnetExampleRequestUrl();
  const paymentSignatureHeader =
    init.paymentSignatureHeader === null
      ? undefined
      : init.paymentSignatureHeader ??
        (init.paymentPayload
          ? encodePaymentSignatureHeader(init.paymentPayload)
          : undefined);
  const ctx: MainnetOrchestratorContext = {
    deps,
    request: {
      method: "GET",
      url,
      paymentSignatureHeader,
    },
  };
  return handleMainnetExampleRequest(ctx);
}

export async function dispatchMainnetPaidRequest(
  deps: MainnetOrchestratorDeps,
  payload?: PaymentPayload,
  url = buildMainnetExampleRequestUrl(),
): Promise<Response> {
  const resolvedPayload =
    payload ??
    (await buildTestPaymentPayload(deps, {
      value: url.searchParams.get("value") ?? MAINNET_TEST_QUERY_VALUE,
    }));
  return dispatchMainnetOrchestratorRequest(deps, {
    url,
    paymentPayload: resolvedPayload,
  });
}

export async function dispatchMainnetUnpaidRequest(
  deps: MainnetOrchestratorDeps,
  url = buildMainnetExampleRequestUrl(),
): Promise<Response> {
  return dispatchMainnetOrchestratorRequest(deps, { url, paymentSignatureHeader: null });
}
