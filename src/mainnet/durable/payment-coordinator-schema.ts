import type { DurableObjectState, SqlStorage } from "@cloudflare/workers-types";

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

const ALLOWED_STATES_SQL = PAYMENT_ATTEMPT_STATES.map((state) => `'${state}'`).join(
  ", ",
);

export function initializePaymentCoordinatorSchema(sql: SqlStorage): void {
  sql.exec(`
    CREATE TABLE IF NOT EXISTS payment_attempts (
      record_key TEXT PRIMARY KEY,
      payment_identifier TEXT NOT NULL,
      auth_commitment TEXT NOT NULL,
      terms_fingerprint TEXT NOT NULL,
      resource_identity_hash TEXT NOT NULL,
      authorization_nonce TEXT NOT NULL,
      network TEXT NOT NULL,
      asset TEXT NOT NULL,
      amount TEXT NOT NULL,
      state TEXT NOT NULL CHECK (state IN (${ALLOWED_STATES_SQL})),
      operation_kind TEXT CHECK (operation_kind IN ('verify', 'settle') OR operation_kind IS NULL),
      operation_generation INTEGER NOT NULL DEFAULT 0,
      operation_token TEXT,
      operation_started_at TEXT,
      lease_expires_at TEXT,
      cached_response_json TEXT,
      cached_content_type TEXT,
      settlement_receipt_json TEXT,
      transaction_hash TEXT,
      failure_category TEXT,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL,
      expires_at TEXT NOT NULL
    );
  `);

  sql.exec(`
    CREATE UNIQUE INDEX IF NOT EXISTS idx_payment_attempts_payment_identifier
    ON payment_attempts (payment_identifier);
  `);

  sql.exec(`
    CREATE UNIQUE INDEX IF NOT EXISTS idx_payment_attempts_auth_commitment
    ON payment_attempts (auth_commitment);
  `);

  sql.exec(`
    CREATE INDEX IF NOT EXISTS idx_payment_attempts_state_updated
    ON payment_attempts (state, updated_at);
  `);

  sql.exec(`
    CREATE INDEX IF NOT EXISTS idx_payment_attempts_expires_at
    ON payment_attempts (expires_at);
  `);
}
