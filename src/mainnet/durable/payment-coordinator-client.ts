/// <reference path="../../../worker-configuration.mainnet.d.ts" />

import { COORDINATOR_DO_NAME } from "../mainnet-config.js";
import type {
  AuthenticatedFailureResult,
  CompletionResult,
  CoordinatorRpcRequest,
  CoordinatorRpcResponse,
  FailPostVerifyDefinitiveParams,
  FailSettleDefinitiveParams,
  FailVerifyDefinitiveParams,
  LeaseAcquireResult,
  PaymentStatusSnapshot,
  PrepareAttemptInput,
  PrepareAttemptResult,
  StageResponseResult,
} from "./payment-attempt-types.js";

const RPC_URL = "https://payment-coordinator.internal/rpc";

export type CoordinatorFailureInjectionPoint =
  | "prepareAttempt"
  | "acquireVerifyLease"
  | "completeVerify"
  | "stageResponse"
  | "acquireSettleLease"
  | "completeFulfillment"
  | "markVerifyUncertain"
  | "markSettleUncertain";

export type CoordinatorFailureInjection = Partial<
  Record<CoordinatorFailureInjectionPoint, () => void | Promise<void>>
>;

let coordinatorFailureInjection: CoordinatorFailureInjection | null = null;

/** Test-only hook for deterministic coordinator failure injection. */
export function setCoordinatorFailureInjectionForTests(
  injection: CoordinatorFailureInjection | null,
): void {
  coordinatorFailureInjection = injection;
}

async function runCoordinatorFailureInjection(
  point: CoordinatorFailureInjectionPoint,
): Promise<void> {
  const hook = coordinatorFailureInjection?.[point];
  if (hook) {
    await hook();
  }
}

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
  await runCoordinatorFailureInjection("prepareAttempt");
  return callCoordinator(namespace, { method: "prepareAttempt", params: input });
}

export async function coordinatorAcquireVerifyLease(
  namespace: DurableObjectNamespace,
  params: { recordKey: string; leaseExpiresAt?: string | null },
): Promise<LeaseAcquireResult> {
  await runCoordinatorFailureInjection("acquireVerifyLease");
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
  await runCoordinatorFailureInjection("completeVerify");
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
  await runCoordinatorFailureInjection("markVerifyUncertain");
  return callCoordinator(namespace, { method: "markVerifyUncertain", params });
}

export async function coordinatorStageResponse(
  namespace: DurableObjectNamespace,
  params: { recordKey: string; body: string; contentType: string },
): Promise<StageResponseResult> {
  await runCoordinatorFailureInjection("stageResponse");
  return callCoordinator(namespace, { method: "stageResponse", params });
}

export async function coordinatorAcquireSettleLease(
  namespace: DurableObjectNamespace,
  params: { recordKey: string; leaseExpiresAt?: string | null },
): Promise<LeaseAcquireResult> {
  await runCoordinatorFailureInjection("acquireSettleLease");
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
  await runCoordinatorFailureInjection("completeFulfillment");
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
  await runCoordinatorFailureInjection("markSettleUncertain");
  return callCoordinator(namespace, { method: "markSettleUncertain", params });
}

export async function coordinatorFailVerifyDefinitive(
  namespace: DurableObjectNamespace,
  params: FailVerifyDefinitiveParams,
): Promise<AuthenticatedFailureResult> {
  return callCoordinator(namespace, { method: "failVerifyDefinitive", params });
}

export async function coordinatorFailPostVerifyDefinitive(
  namespace: DurableObjectNamespace,
  params: FailPostVerifyDefinitiveParams,
): Promise<AuthenticatedFailureResult> {
  return callCoordinator(namespace, {
    method: "failPostVerifyDefinitive",
    params,
  });
}

export async function coordinatorFailSettleDefinitive(
  namespace: DurableObjectNamespace,
  params: FailSettleDefinitiveParams,
): Promise<AuthenticatedFailureResult> {
  return callCoordinator(namespace, { method: "failSettleDefinitive", params });
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
