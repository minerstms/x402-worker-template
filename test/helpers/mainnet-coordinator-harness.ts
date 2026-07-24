import path from "node:path";
import { fileURLToPath } from "node:url";
import { Miniflare } from "miniflare";
import {
  buildAuthCommitment,
  buildRecordKey,
  buildResourceIdentityHash,
  buildTermsFingerprint,
  type AuthCommitmentInput,
  type TermsFingerprintInput,
} from "../../src/mainnet/idempotency/canonical-keys.js";
import type { PrepareAttemptInput } from "../../src/mainnet/durable/payment-attempt-types.js";
import {
  coordinatorAcquireSettleLease,
  coordinatorAcquireVerifyLease,
  coordinatorCompleteFulfillment,
  coordinatorCompleteVerify,
  coordinatorGetReplay,
  coordinatorGetStatusByPaymentIdentifier,
  coordinatorMarkSettleUncertain,
  coordinatorMarkVerifyUncertain,
  coordinatorPrepareAttempt,
  coordinatorRunTtlCleanup,
  coordinatorStageResponse,
} from "../../src/mainnet/durable/payment-coordinator-client.js";
import { RECORD_TTL_MS } from "../../src/mainnet/mainnet-config.js";

const projectRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");

export type MainnetTestBindings = {
  PAYMENT_COORDINATOR: DurableObjectNamespace;
};

export async function createMainnetCoordinatorMiniflare(): Promise<Miniflare> {
  return new Miniflare({
    scriptPath: path.join(projectRoot, "dist-mainnet/index.mainnet.js"),
    modules: true,
    compatibilityDate: "2025-07-21",
    compatibilityFlags: ["nodejs_compat"],
    durableObjects: {
      PAYMENT_COORDINATOR: {
        className: "PaymentCoordinatorDurableObject",
        useSQLite: true,
      },
    },
  });
}

export async function createMainnetTestContext(): Promise<{
  mf: Miniflare;
  bindings: MainnetTestBindings;
}> {
  const mf = await createMainnetCoordinatorMiniflare();
  const bindings = await mf.getBindings<MainnetTestBindings>();
  return { mf, bindings };
}

export async function getMainnetBindings(): Promise<MainnetTestBindings> {
  const { bindings } = await createMainnetTestContext();
  return bindings;
}

const defaultTermsInput: TermsFingerprintInput = {
  scheme: "exact",
  network: "eip155:8453",
  asset: "0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913",
  amount: "1000",
  payTo: "0x000000000000000000000000000000000000dEaD",
  httpMethod: "GET",
  normalizedRoute: "/v1/example",
  normalizedQuery: { value: "demo" },
};

const defaultAuthInput: AuthCommitmentInput = {
  network: "eip155:8453",
  from: "0x1111111111111111111111111111111111111111",
  authorizationNonce: "nonce-primary",
  to: "0x000000000000000000000000000000000000dEaD",
  value: "1000",
  validAfter: "0",
  validBefore: "9999999999",
  verifyingContract: "0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913",
};

export async function buildTestPrepareInput(
  overrides: {
    paymentIdentifier?: string;
    terms?: Partial<TermsFingerprintInput>;
    auth?: Partial<AuthCommitmentInput>;
    resourceQuery?: Record<string, string>;
  } = {},
): Promise<PrepareAttemptInput> {
  const paymentIdentifier =
    overrides.paymentIdentifier ?? "pay_7d5d747be160e280";
  const termsInput = { ...defaultTermsInput, ...overrides.terms };
  const authInput = { ...defaultAuthInput, ...overrides.auth };
  const termsFingerprint = await buildTermsFingerprint(termsInput);
  const authCommitment = await buildAuthCommitment(authInput);
  const resourceIdentityHash = await buildResourceIdentityHash({
    httpMethod: termsInput.httpMethod,
    normalizedRoute: termsInput.normalizedRoute,
    normalizedQuery: termsInput.normalizedQuery,
  });

  return {
    paymentIdentifier,
    termsFingerprint,
    authCommitment,
    resourceIdentityHash,
    authorizationNonce: authInput.authorizationNonce,
    network: termsInput.network,
    asset: termsInput.asset,
    amount: termsInput.amount,
  };
}

export async function buildTestRecordKey(input: PrepareAttemptInput): Promise<string> {
  return buildRecordKey(input.paymentIdentifier, input.termsFingerprint);
}

export function validSettlementReceipt(transaction = `0x${"a".repeat(64)}`) {
  return {
    success: true,
    transaction,
    network: "eip155:8453",
  };
}

export async function prepareCreatedAttempt(bindings: MainnetTestBindings) {
  const input = await buildTestPrepareInput();
  const result = await coordinatorPrepareAttempt(bindings.PAYMENT_COORDINATOR, input);
  const recordKey =
    "recordKey" in result ? result.recordKey : await buildTestRecordKey(input);
  return { input, result, recordKey };
}

export async function advanceToVerified(
  bindings: MainnetTestBindings,
  recordKey: string,
) {
  const lease = await coordinatorAcquireVerifyLease(bindings.PAYMENT_COORDINATOR, {
    recordKey,
  });
  if (lease.kind !== "acquired") {
    throw new Error(`Expected verify lease, got ${lease.kind}`);
  }
  await coordinatorCompleteVerify(bindings.PAYMENT_COORDINATOR, {
    recordKey,
    operationGeneration: lease.operationGeneration,
    operationToken: lease.operationToken,
  });
  return lease;
}

export async function advanceToComputing(
  bindings: MainnetTestBindings,
  recordKey: string,
  body = JSON.stringify({ ok: true, service: "proof" }),
) {
  await advanceToVerified(bindings, recordKey);
  const staged = await coordinatorStageResponse(bindings.PAYMENT_COORDINATOR, {
    recordKey,
    body,
    contentType: "application/json",
  });
  if (staged.kind !== "staged") {
    throw new Error(`Expected staged response, got ${staged.kind}`);
  }
}

export async function advanceToSettling(
  bindings: MainnetTestBindings,
  recordKey: string,
) {
  await advanceToComputing(bindings, recordKey);
  const lease = await coordinatorAcquireSettleLease(bindings.PAYMENT_COORDINATOR, {
    recordKey,
  });
  if (lease.kind !== "acquired") {
    throw new Error(`Expected settle lease, got ${lease.kind}`);
  }
  return lease;
}

export async function fulfillAttempt(
  bindings: MainnetTestBindings,
  recordKey: string,
  lease: Awaited<ReturnType<typeof coordinatorAcquireSettleLease>> & {
    kind: "acquired";
  },
) {
  return coordinatorCompleteFulfillment(bindings.PAYMENT_COORDINATOR, {
    recordKey,
    operationGeneration: lease.operationGeneration,
    operationToken: lease.operationToken,
    settlementReceipt: validSettlementReceipt(),
  });
}

export async function cleanupAfterTtl(bindings: MainnetTestBindings) {
  const cutoff = new Date(Date.now() + RECORD_TTL_MS + 60_000).toISOString();
  return coordinatorRunTtlCleanup(bindings.PAYMENT_COORDINATOR, cutoff);
}

export {
  coordinatorAcquireSettleLease,
  coordinatorAcquireVerifyLease,
  coordinatorCompleteFulfillment,
  coordinatorCompleteVerify,
  coordinatorGetReplay,
  coordinatorGetStatusByPaymentIdentifier,
  coordinatorMarkSettleUncertain,
  coordinatorMarkVerifyUncertain,
  coordinatorPrepareAttempt,
  coordinatorStageResponse,
};
