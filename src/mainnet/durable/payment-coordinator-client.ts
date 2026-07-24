/// <reference path="../../../worker-configuration.mainnet.d.ts" />

import { COORDINATOR_DO_NAME } from "../mainnet-config.js";
import type {
  CompletionResult,
  CoordinatorRpcRequest,
  CoordinatorRpcResponse,
  FailDefinitiveResult,
  LeaseAcquireResult,
  PaymentStatusSnapshot,
  PrepareAttemptInput,
  PrepareAttemptResult,
  StageResponseResult,
} from "./payment-attempt-types.js";

const RPC_URL = "https://payment-coordinator.internal/rpc";

function getCoordinatorStub(namespace: DurableObjectNamespace) {
  const id = namespace.idFromName(COORDINATOR_DO_NAME);
  return namespace.get(id);
}

async function callCoordinator<T>(
  namespace: DurableObjectNamespace,
  request: CoordinatorRpcRequest,
): Promise<T> {
  const stub = getCoordinatorStub(namespace);
  const response = await stub.fetch(RPC_URL, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(request),
  });

  if (!response.ok) {
    throw new Error(`Coordinator RPC failed with HTTP ${response.status}.`);
  }

  const payload = (await response.json()) as CoordinatorRpcResponse;
  if (!payload.ok) {
    throw new Error(payload.error);
  }

  return payload.result as T;
}

export async function coordinatorPrepareAttempt(
  namespace: DurableObjectNamespace,
  input: PrepareAttemptInput,
): Promise<PrepareAttemptResult> {
  return callCoordinator(namespace, { method: "prepareAttempt", params: input });
}

export async function coordinatorAcquireVerifyLease(
  namespace: DurableObjectNamespace,
  params: { recordKey: string; leaseExpiresAt?: string | null },
): Promise<LeaseAcquireResult> {
  return callCoordinator(namespace, {
    method: "acquireVerifyLease",
    params,
  });
}

export async function coordinatorCompleteVerify(
  namespace: DurableObjectNamespace,
  params: {
    recordKey: string;
    operationGeneration: number;
    operationToken: string;
  },
): Promise<CompletionResult> {
  return callCoordinator(namespace, { method: "completeVerify", params });
}

export async function coordinatorMarkVerifyUncertain(
  namespace: DurableObjectNamespace,
  params: {
    recordKey: string;
    operationGeneration: number;
    operationToken: string;
  },
): Promise<CompletionResult> {
  return callCoordinator(namespace, { method: "markVerifyUncertain", params });
}

export async function coordinatorStageResponse(
  namespace: DurableObjectNamespace,
  params: { recordKey: string; body: string; contentType: string },
): Promise<StageResponseResult> {
  return callCoordinator(namespace, { method: "stageResponse", params });
}

export async function coordinatorAcquireSettleLease(
  namespace: DurableObjectNamespace,
  params: { recordKey: string; leaseExpiresAt?: string | null },
): Promise<LeaseAcquireResult> {
  return callCoordinator(namespace, {
    method: "acquireSettleLease",
    params,
  });
}

export async function coordinatorCompleteFulfillment(
  namespace: DurableObjectNamespace,
  params: {
    recordKey: string;
    operationGeneration: number;
    operationToken: string;
    settlementReceipt: unknown;
  },
): Promise<CompletionResult> {
  return callCoordinator(namespace, { method: "completeFulfillment", params });
}

export async function coordinatorMarkSettleUncertain(
  namespace: DurableObjectNamespace,
  params: {
    recordKey: string;
    operationGeneration: number;
    operationToken: string;
  },
): Promise<CompletionResult> {
  return callCoordinator(namespace, { method: "markSettleUncertain", params });
}

export async function coordinatorFailDefinitive(
  namespace: DurableObjectNamespace,
  params: { recordKey: string; failureCategory?: string | null },
): Promise<FailDefinitiveResult> {
  return callCoordinator(namespace, { method: "failDefinitive", params });
}

export async function coordinatorGetReplay(
  namespace: DurableObjectNamespace,
  recordKey: string,
): Promise<unknown> {
  return callCoordinator(namespace, { method: "getReplay", params: { recordKey } });
}

export async function coordinatorGetStatusByPaymentIdentifier(
  namespace: DurableObjectNamespace,
  paymentIdentifier: string,
): Promise<PaymentStatusSnapshot | null> {
  return callCoordinator(namespace, {
    method: "getStatusByPaymentIdentifier",
    params: { paymentIdentifier },
  });
}

export async function coordinatorRunTtlCleanup(
  namespace: DurableObjectNamespace,
  now?: string,
): Promise<{ deletedCount: number }> {
  return callCoordinator(namespace, {
    method: "runTtlCleanup",
    params: { now },
  });
}

export { getCoordinatorStub };
