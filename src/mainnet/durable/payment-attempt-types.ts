export const PAYMENT_ATTEMPT_STATES = [
  "reserved",
  "verifying",
  "verified",
  "computing",
  "settling",
  "fulfilled",
  "failed-definitive",
  "uncertain",
] as const;

export type PaymentAttemptState = (typeof PAYMENT_ATTEMPT_STATES)[number];

export type OperationKind = "verify" | "settle";

export type PrepareAttemptInput = {
  paymentIdentifier: string;
  termsFingerprint: string;
  authCommitment: string;
  resourceIdentityHash: string;
  authorizationNonce: string;
  network: string;
  asset: string;
  amount: string;
};

export type PrepareAttemptResult =
  | { kind: "created"; recordKey: string; state: "reserved" }
  | { kind: "replay"; recordKey: string }
  | { kind: "wait"; recordKey: string; state: PaymentAttemptState }
  | { kind: "conflict"; reason: string }
  | { kind: "failed"; recordKey: string }
  | { kind: "uncertain"; recordKey: string };

export type LeaseAcquireResult =
  | {
      kind: "acquired";
      recordKey: string;
      operationKind: OperationKind;
      operationGeneration: number;
      operationToken: string;
      leaseExpiresAt: string | null;
    }
  | { kind: "rejected"; reason: string };

export type CompletionResult =
  | { kind: "completed"; recordKey: string; state: PaymentAttemptState }
  | { kind: "stale"; reason: string };

export type StageResponseResult =
  | { kind: "staged"; recordKey: string }
  | { kind: "rejected"; reason: string };

export type FailDefinitiveResult =
  | { kind: "failed"; recordKey: string }
  | { kind: "rejected"; reason: string };

export type PaymentAttemptRow = {
  record_key: string;
  payment_identifier: string;
  auth_commitment: string;
  terms_fingerprint: string;
  resource_identity_hash: string;
  authorization_nonce: string;
  network: string;
  asset: string;
  amount: string;
  state: PaymentAttemptState;
  operation_kind: OperationKind | null;
  operation_generation: number;
  operation_token: string | null;
  operation_started_at: string | null;
  lease_expires_at: string | null;
  cached_response_json: string | null;
  cached_content_type: string | null;
  settlement_receipt_json: string | null;
  transaction_hash: string | null;
  failure_category: string | null;
  created_at: string;
  updated_at: string;
  expires_at: string;
};

export type PaymentStatusSnapshot = {
  state: PaymentAttemptState;
  updatedAt: string;
  transactionHash: string | null;
  expiresAt: string;
};

export type CoordinatorRpcRequest =
  | { method: "prepareAttempt"; params: PrepareAttemptInput }
  | {
      method: "acquireVerifyLease";
      params: { recordKey: string; leaseExpiresAt?: string | null };
    }
  | {
      method: "completeVerify";
      params: {
        recordKey: string;
        operationGeneration: number;
        operationToken: string;
      };
    }
  | {
      method: "markVerifyUncertain";
      params: {
        recordKey: string;
        operationGeneration: number;
        operationToken: string;
      };
    }
  | {
      method: "stageResponse";
      params: { recordKey: string; body: string; contentType: string };
    }
  | {
      method: "acquireSettleLease";
      params: { recordKey: string; leaseExpiresAt?: string | null };
    }
  | {
      method: "completeFulfillment";
      params: {
        recordKey: string;
        operationGeneration: number;
        operationToken: string;
        settlementReceipt: unknown;
      };
    }
  | {
      method: "markSettleUncertain";
      params: {
        recordKey: string;
        operationGeneration: number;
        operationToken: string;
      };
    }
  | {
      method: "failDefinitive";
      params: { recordKey: string; failureCategory?: string | null };
    }
  | { method: "getReplay"; params: { recordKey: string } }
  | { method: "getStatusByPaymentIdentifier"; params: { paymentIdentifier: string } }
  | { method: "runTtlCleanup"; params: { now?: string } };

export type CoordinatorRpcResponse =
  | { ok: true; result: unknown }
  | { ok: false; error: string };
