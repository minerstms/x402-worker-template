import { DurableObject } from "cloudflare:workers";
import type { SqlStorage } from "@cloudflare/workers-types";
import { buildRecordKey } from "../idempotency/canonical-keys.js";
import { buildFulfilledReplayResponse } from "../idempotency/replay-response.js";
import { validateSettlementReceiptForStorage } from "../idempotency/settlement-receipt.js";
import {
  ALLOWED_STAGED_CONTENT_TYPE,
  RECORD_TTL_MS,
  STAGED_RESPONSE_MAX_BYTES,
} from "../mainnet-config.js";
import type {
  CompletionResult,
  CoordinatorRpcRequest,
  CoordinatorRpcResponse,
  FailDefinitiveResult,
  LeaseAcquireResult,
  PaymentAttemptRow,
  PaymentAttemptState,
  PaymentStatusSnapshot,
  PrepareAttemptInput,
  PrepareAttemptResult,
  StageResponseResult,
} from "./payment-attempt-types.js";
import { initializePaymentCoordinatorSchema } from "./payment-coordinator-schema.js";

const IN_PROGRESS_STATES: PaymentAttemptState[] = [
  "reserved",
  "verifying",
  "verified",
  "computing",
  "settling",
];

function nowIso(now?: string): string {
  return now ?? new Date().toISOString();
}

function generateOperationToken(): string {
  const bytes = new Uint8Array(32);
  crypto.getRandomValues(bytes);
  return [...bytes].map((byte) => byte.toString(16).padStart(2, "0")).join("");
}

function isSameAttemptIdentity(
  row: PaymentAttemptRow,
  input: PrepareAttemptInput,
): boolean {
  return (
    row.payment_identifier === input.paymentIdentifier &&
    row.terms_fingerprint === input.termsFingerprint &&
    row.auth_commitment === input.authCommitment &&
    row.resource_identity_hash === input.resourceIdentityHash &&
    row.authorization_nonce === input.authorizationNonce &&
    row.network === input.network &&
    row.asset === input.asset &&
    row.amount === input.amount
  );
}

function readRow(
  sql: SqlStorage,
  recordKey: string,
): PaymentAttemptRow | null {
  const cursor = sql.exec<PaymentAttemptRow>(
    `SELECT * FROM payment_attempts WHERE record_key = ? LIMIT 1`,
    recordKey,
  );
  return cursor.toArray()[0] ?? null;
}

function readRowByPaymentIdentifier(
  sql: SqlStorage,
  paymentIdentifier: string,
): PaymentAttemptRow | null {
  const cursor = sql.exec<PaymentAttemptRow>(
    `SELECT * FROM payment_attempts WHERE payment_identifier = ? LIMIT 1`,
    paymentIdentifier,
  );
  return cursor.toArray()[0] ?? null;
}

function readRowByAuthCommitment(
  sql: SqlStorage,
  authCommitment: string,
): PaymentAttemptRow | null {
  const cursor = sql.exec<PaymentAttemptRow>(
    `SELECT * FROM payment_attempts WHERE auth_commitment = ? LIMIT 1`,
    authCommitment,
  );
  return cursor.toArray()[0] ?? null;
}

function sqlChanges(sql: SqlStorage): number {
  const cursor = sql.exec<{ changes: number }>(`SELECT changes() AS changes`);
  return Number(cursor.toArray()[0]?.changes ?? 0);
}

function isUniqueConstraintError(error: unknown): boolean {
  return (
    error instanceof Error &&
    /UNIQUE constraint failed|SQLITE_CONSTRAINT/i.test(error.message)
  );
}

export class PaymentCoordinatorDurableObject extends DurableObject {
  private schemaReady = false;

  constructor(
    ctx: ConstructorParameters<typeof DurableObject>[0],
    env: MainnetEnv,
  ) {
    super(ctx, env);
    ctx.blockConcurrencyWhile(async () => {
      initializePaymentCoordinatorSchema(ctx.storage.sql as SqlStorage);
      this.schemaReady = true;
      await this.scheduleNextCleanupAlarm();
    });
  }

  async fetch(request: Request): Promise<Response> {
    if (!this.schemaReady) {
      return Response.json(
        { ok: false, error: "Coordinator not ready." },
        { status: 503 },
      );
    }

    if (request.method !== "POST") {
      return Response.json(
        { ok: false, error: "Method not allowed." },
        { status: 405 },
      );
    }

    let payload: CoordinatorRpcRequest;
    try {
      payload = (await request.json()) as CoordinatorRpcRequest;
    } catch {
      return Response.json({ ok: false, error: "Invalid JSON body." }, { status: 400 });
    }

    const response = await this.handleRpc(payload);
    return Response.json(response, {
      headers: { "Cache-Control": "no-store" },
    });
  }

  async alarm(): Promise<void> {
    const deleted = this.runTtlCleanup();
    console.log(`payment-coordinator ttl cleanup removed ${deleted} expired records`);
    await this.scheduleNextCleanupAlarm();
  }

  private async handleRpc(
    request: CoordinatorRpcRequest,
  ): Promise<CoordinatorRpcResponse> {
    try {
      switch (request.method) {
        case "prepareAttempt":
          return { ok: true, result: await this.prepareAttempt(request.params) };
        case "acquireVerifyLease":
          return { ok: true, result: this.acquireVerifyLease(request.params) };
        case "completeVerify":
          return { ok: true, result: this.completeVerify(request.params) };
        case "markVerifyUncertain":
          return { ok: true, result: this.markVerifyUncertain(request.params) };
        case "stageResponse":
          return { ok: true, result: this.stageResponse(request.params) };
        case "acquireSettleLease":
          return { ok: true, result: this.acquireSettleLease(request.params) };
        case "completeFulfillment":
          return { ok: true, result: this.completeFulfillment(request.params) };
        case "markSettleUncertain":
          return { ok: true, result: this.markSettleUncertain(request.params) };
        case "failDefinitive":
          return { ok: true, result: this.failDefinitive(request.params) };
        case "getReplay":
          return { ok: true, result: this.getReplay(request.params.recordKey) };
        case "getStatusByPaymentIdentifier":
          return {
            ok: true,
            result: this.getStatusByPaymentIdentifier(
              request.params.paymentIdentifier,
            ),
          };
        case "runTtlCleanup":
          return {
            ok: true,
            result: { deletedCount: this.runTtlCleanup(request.params.now) },
          };
        default:
          return { ok: false, error: "Unknown coordinator method." };
      }
    } catch (error) {
      if (isUniqueConstraintError(error)) {
        return { ok: true, result: { kind: "conflict", reason: "Unique constraint violated." } };
      }
      throw error;
    }
  }

  private async prepareAttempt(input: PrepareAttemptInput): Promise<PrepareAttemptResult> {
    const sql = this.ctx.storage.sql;
    const recordKey = await buildRecordKey(
      input.paymentIdentifier,
      input.termsFingerprint,
    );

    const existing = readRow(sql, recordKey);
    if (existing) {
      return this.classifyExistingPrepareRow(existing, input);
    }

    const byPaymentId = readRowByPaymentIdentifier(sql, input.paymentIdentifier);
    if (byPaymentId) {
      if (byPaymentId.terms_fingerprint !== input.termsFingerprint) {
        return { kind: "conflict", reason: "Payment identifier is bound to different terms." };
      }
      if (byPaymentId.auth_commitment !== input.authCommitment) {
        return { kind: "conflict", reason: "Payment identifier is bound to different authorization." };
      }
      return this.classifyExistingPrepareRow(byPaymentId, input);
    }

    const byAuth = readRowByAuthCommitment(sql, input.authCommitment);
    if (byAuth && byAuth.payment_identifier !== input.paymentIdentifier) {
      return { kind: "conflict", reason: "Authorization is bound to a different payment identifier." };
    }

    const timestamp = nowIso();
    const expiresAt = new Date(Date.now() + RECORD_TTL_MS).toISOString();

    try {
      const insert = sql.exec(
        `INSERT INTO payment_attempts (
          record_key, payment_identifier, auth_commitment, terms_fingerprint,
          resource_identity_hash, authorization_nonce, network, asset, amount,
          state, operation_generation, created_at, updated_at, expires_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 'reserved', 0, ?, ?, ?)`,
        recordKey,
        input.paymentIdentifier,
        input.authCommitment,
        input.termsFingerprint,
        input.resourceIdentityHash,
        input.authorizationNonce,
        input.network,
        input.asset,
        input.amount,
        timestamp,
        timestamp,
        expiresAt,
      );
      void insert;
      await this.scheduleNextCleanupAlarm();
      return { kind: "created", recordKey, state: "reserved" };
    } catch (error) {
      if (isUniqueConstraintError(error)) {
        const replayRow =
          readRow(sql, recordKey) ??
          readRowByPaymentIdentifier(sql, input.paymentIdentifier) ??
          readRowByAuthCommitment(sql, input.authCommitment);
        if (replayRow) {
          return this.classifyExistingPrepareRow(replayRow, input);
        }
        return { kind: "conflict", reason: "Unique constraint violated." };
      }
      throw error;
    }
  }

  private classifyExistingPrepareRow(
    row: PaymentAttemptRow,
    input: PrepareAttemptInput,
  ): PrepareAttemptResult {
    if (!isSameAttemptIdentity(row, input)) {
      if (row.payment_identifier === input.paymentIdentifier) {
        if (row.terms_fingerprint !== input.termsFingerprint) {
          return { kind: "conflict", reason: "Payment identifier is bound to different terms." };
        }
        return { kind: "conflict", reason: "Payment identifier is bound to different authorization." };
      }
      return { kind: "conflict", reason: "Authorization is bound to a different payment identifier." };
    }

    if (row.state === "fulfilled") {
      return { kind: "replay", recordKey: row.record_key };
    }
    if (row.state === "failed-definitive") {
      return { kind: "failed", recordKey: row.record_key };
    }
    if (row.state === "uncertain") {
      return { kind: "uncertain", recordKey: row.record_key };
    }
    if (IN_PROGRESS_STATES.includes(row.state)) {
      return { kind: "wait", recordKey: row.record_key, state: row.state };
    }
    return { kind: "wait", recordKey: row.record_key, state: row.state };
  }

  private acquireVerifyLease(params: {
    recordKey: string;
    leaseExpiresAt?: string | null;
  }): LeaseAcquireResult {
    const sql = this.ctx.storage.sql;
    const row = readRow(sql, params.recordKey);
    if (!row) {
      return { kind: "rejected", reason: "Record not found." };
    }
    if (row.state === "uncertain") {
      return { kind: "rejected", reason: "Verify lease cannot be acquired from uncertain." };
    }
    if (row.state !== "reserved") {
      return { kind: "rejected", reason: "Verify lease requires reserved state." };
    }

    const operationToken = generateOperationToken();
    const startedAt = nowIso();
    const nextGeneration = row.operation_generation + 1;
    sql.exec(
      `UPDATE payment_attempts SET
        state = 'verifying',
        operation_kind = 'verify',
        operation_generation = ?,
        operation_token = ?,
        operation_started_at = ?,
        lease_expires_at = ?,
        updated_at = ?
      WHERE record_key = ? AND state = 'reserved'`,
      nextGeneration,
      operationToken,
      startedAt,
      params.leaseExpiresAt ?? null,
      startedAt,
      params.recordKey,
    );

    if (sqlChanges(sql) !== 1) {
      return { kind: "rejected", reason: "Verify lease was not acquired." };
    }

    return {
      kind: "acquired",
      recordKey: params.recordKey,
      operationKind: "verify",
      operationGeneration: nextGeneration,
      operationToken,
      leaseExpiresAt: params.leaseExpiresAt ?? null,
    };
  }

  private completeVerify(params: {
    recordKey: string;
    operationGeneration: number;
    operationToken: string;
  }): CompletionResult {
    const sql = this.ctx.storage.sql;
    const timestamp = nowIso();
    sql.exec(
      `UPDATE payment_attempts SET
        state = 'verified',
        lease_expires_at = NULL,
        updated_at = ?
      WHERE record_key = ?
        AND operation_kind = 'verify'
        AND operation_generation = ?
        AND operation_token = ?
        AND state IN ('verifying', 'uncertain')`,
      timestamp,
      params.recordKey,
      params.operationGeneration,
      params.operationToken,
    );

    if (sqlChanges(sql) !== 1) {
      return { kind: "stale", reason: "Verify completion did not match an active lease." };
    }

    return { kind: "completed", recordKey: params.recordKey, state: "verified" };
  }

  private markVerifyUncertain(params: {
    recordKey: string;
    operationGeneration: number;
    operationToken: string;
  }): CompletionResult {
    const sql = this.ctx.storage.sql;
    const timestamp = nowIso();
    sql.exec(
      `UPDATE payment_attempts SET
        state = 'uncertain',
        lease_expires_at = NULL,
        updated_at = ?
      WHERE record_key = ?
        AND operation_kind = 'verify'
        AND operation_generation = ?
        AND operation_token = ?
        AND state = 'verifying'`,
      timestamp,
      params.recordKey,
      params.operationGeneration,
      params.operationToken,
    );

    if (sqlChanges(sql) !== 1) {
      return { kind: "stale", reason: "Verify uncertainty marker did not match an active lease." };
    }

    return { kind: "completed", recordKey: params.recordKey, state: "uncertain" };
  }

  private stageResponse(params: {
    recordKey: string;
    body: string;
    contentType: string;
  }): StageResponseResult {
    if (params.contentType !== ALLOWED_STAGED_CONTENT_TYPE) {
      return { kind: "rejected", reason: "Only application/json responses may be staged." };
    }

    const bodyBytes = new TextEncoder().encode(params.body);
    if (bodyBytes.byteLength > STAGED_RESPONSE_MAX_BYTES) {
      return { kind: "rejected", reason: "Staged response exceeds maximum size." };
    }

    try {
      JSON.parse(params.body);
    } catch {
      return { kind: "rejected", reason: "Staged response must be valid UTF-8 JSON." };
    }

    const sql = this.ctx.storage.sql;
    const timestamp = nowIso();
    sql.exec(
      `UPDATE payment_attempts SET
        state = 'computing',
        cached_response_json = ?,
        cached_content_type = ?,
        updated_at = ?
      WHERE record_key = ? AND state = 'verified'`,
      params.body,
      params.contentType,
      timestamp,
      params.recordKey,
    );

    if (sqlChanges(sql) !== 1) {
      return { kind: "rejected", reason: "Response staging requires verified state." };
    }

    return { kind: "staged", recordKey: params.recordKey };
  }

  private acquireSettleLease(params: {
    recordKey: string;
    leaseExpiresAt?: string | null;
  }): LeaseAcquireResult {
    const sql = this.ctx.storage.sql;
    const row = readRow(sql, params.recordKey);
    if (!row) {
      return { kind: "rejected", reason: "Record not found." };
    }
    if (row.state === "uncertain") {
      return { kind: "rejected", reason: "Settle lease cannot be acquired from uncertain." };
    }
    if (row.state !== "computing") {
      return { kind: "rejected", reason: "Settle lease requires computing state." };
    }
    if (!row.cached_response_json || row.cached_content_type !== ALLOWED_STAGED_CONTENT_TYPE) {
      return { kind: "rejected", reason: "Settle lease requires a staged JSON response." };
    }

    const operationToken = generateOperationToken();
    const startedAt = nowIso();
    const nextGeneration = row.operation_generation + 1;
    sql.exec(
      `UPDATE payment_attempts SET
        state = 'settling',
        operation_kind = 'settle',
        operation_generation = ?,
        operation_token = ?,
        operation_started_at = ?,
        lease_expires_at = ?,
        updated_at = ?
      WHERE record_key = ?
        AND state = 'computing'
        AND cached_response_json IS NOT NULL
        AND cached_content_type = ?`,
      nextGeneration,
      operationToken,
      startedAt,
      params.leaseExpiresAt ?? null,
      startedAt,
      params.recordKey,
      ALLOWED_STAGED_CONTENT_TYPE,
    );

    if (sqlChanges(sql) !== 1) {
      return { kind: "rejected", reason: "Settle lease was not acquired." };
    }

    return {
      kind: "acquired",
      recordKey: params.recordKey,
      operationKind: "settle",
      operationGeneration: nextGeneration,
      operationToken,
      leaseExpiresAt: params.leaseExpiresAt ?? null,
    };
  }

  private completeFulfillment(params: {
    recordKey: string;
    operationGeneration: number;
    operationToken: string;
    settlementReceipt: unknown;
  }): CompletionResult {
    const receiptResult = validateSettlementReceiptForStorage(params.settlementReceipt);
    if (!receiptResult.ok) {
      return { kind: "stale", reason: receiptResult.reason };
    }

    const sql = this.ctx.storage.sql;
    const row = readRow(sql, params.recordKey);
    if (!row?.cached_response_json || row.cached_content_type !== ALLOWED_STAGED_CONTENT_TYPE) {
      return { kind: "stale", reason: "Fulfillment requires a staged JSON response." };
    }

    const timestamp = nowIso();
    const receiptJson = JSON.stringify(receiptResult.receipt);
    sql.exec(
      `UPDATE payment_attempts SET
        state = 'fulfilled',
        settlement_receipt_json = ?,
        transaction_hash = ?,
        lease_expires_at = NULL,
        operation_kind = NULL,
        operation_token = NULL,
        updated_at = ?
      WHERE record_key = ?
        AND operation_kind = 'settle'
        AND operation_generation = ?
        AND operation_token = ?
        AND state IN ('settling', 'uncertain')
        AND cached_response_json IS NOT NULL
        AND cached_content_type = ?`,
      receiptJson,
      receiptResult.receipt.transaction,
      timestamp,
      params.recordKey,
      params.operationGeneration,
      params.operationToken,
      ALLOWED_STAGED_CONTENT_TYPE,
    );

    if (sqlChanges(sql) !== 1) {
      return { kind: "stale", reason: "Fulfillment completion did not match an active lease." };
    }

    return { kind: "completed", recordKey: params.recordKey, state: "fulfilled" };
  }

  private markSettleUncertain(params: {
    recordKey: string;
    operationGeneration: number;
    operationToken: string;
  }): CompletionResult {
    const sql = this.ctx.storage.sql;
    const timestamp = nowIso();
    sql.exec(
      `UPDATE payment_attempts SET
        state = 'uncertain',
        lease_expires_at = NULL,
        updated_at = ?
      WHERE record_key = ?
        AND operation_kind = 'settle'
        AND operation_generation = ?
        AND operation_token = ?
        AND state = 'settling'`,
      timestamp,
      params.recordKey,
      params.operationGeneration,
      params.operationToken,
    );

    if (sqlChanges(sql) !== 1) {
      return { kind: "stale", reason: "Settle uncertainty marker did not match an active lease." };
    }

    return { kind: "completed", recordKey: params.recordKey, state: "uncertain" };
  }

  private failDefinitive(params: {
    recordKey: string;
    failureCategory?: string | null;
  }): FailDefinitiveResult {
    const sql = this.ctx.storage.sql;
    const timestamp = nowIso();
    sql.exec(
      `UPDATE payment_attempts SET
        state = 'failed-definitive',
        failure_category = ?,
        lease_expires_at = NULL,
        operation_kind = NULL,
        operation_token = NULL,
        updated_at = ?
      WHERE record_key = ?`,
      params.failureCategory ?? null,
      timestamp,
      params.recordKey,
    );

    if (sqlChanges(sql) !== 1) {
      return { kind: "rejected", reason: "Record not found." };
    }

    return { kind: "failed", recordKey: params.recordKey };
  }

  private getReplay(recordKey: string): unknown {
    const sql = this.ctx.storage.sql;
    const row = readRow(sql, recordKey);
    if (!row || row.state !== "fulfilled") {
      return { ok: false, reason: "Fulfilled replay is unavailable." };
    }

    const replay = buildFulfilledReplayResponse({
      cachedResponseJson: row.cached_response_json,
      cachedContentType: row.cached_content_type,
      settlementReceiptJson: row.settlement_receipt_json,
    });

    if (!replay.ok) {
      return replay;
    }

    return replay;
  }

  private getStatusByPaymentIdentifier(
    paymentIdentifier: string,
  ): PaymentStatusSnapshot | null {
    const sql = this.ctx.storage.sql;
    const row = readRowByPaymentIdentifier(sql, paymentIdentifier);
    if (!row) {
      return null;
    }

    const cutoff = nowIso();
    if (row.expires_at <= cutoff) {
      return null;
    }

    return {
      state: row.state,
      updatedAt: row.updated_at,
      transactionHash: row.transaction_hash,
      expiresAt: row.expires_at,
    };
  }

  private runTtlCleanup(now?: string): number {
    const cutoff = now ?? nowIso();
    this.ctx.storage.sql.exec(
      `DELETE FROM payment_attempts WHERE expires_at <= ?`,
      cutoff,
    );
    return sqlChanges(this.ctx.storage.sql);
  }

  private async scheduleNextCleanupAlarm(): Promise<void> {
    const cursor = this.ctx.storage.sql.exec<{ expires_at: string }>(
      `SELECT MIN(expires_at) AS expires_at FROM payment_attempts`,
    );
    const nextExpiry = cursor.toArray()[0]?.expires_at;
    if (!nextExpiry) {
      return;
    }
    const when = Date.parse(nextExpiry);
    if (Number.isNaN(when)) {
      return;
    }
    await this.ctx.storage.setAlarm(when);
  }
}
