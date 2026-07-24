import type { Context } from "hono";
/// <reference path="../../../worker-configuration.mainnet.d.ts" />
import { coordinatorGetStatusByPaymentIdentifier } from "../durable/payment-coordinator-client.js";
import type {
  FulfilledStatusResult,
  PaymentAttemptState,
} from "../durable/payment-attempt-types.js";
import { MAINNET_SAFE_RESPONSE_HEADERS } from "../http-security-headers.js";
import { validatePaymentIdentifierForLookup } from "../idempotency/payment-identifier.js";

export type SafePaymentStatusBody = {
  state: PaymentAttemptState | "not_seen" | "expired";
  updatedAt?: string;
  canRetry?: boolean;
  needsFreshTerms?: boolean;
  transactionReference?: string;
  result?: FulfilledStatusResult;
};

const IN_PROGRESS_STATES: PaymentAttemptState[] = [
  "reserved",
  "verifying",
  "verified",
  "computing",
  "settling",
];

function shortenTransactionRef(value: string): string {
  if (value.length <= 14) {
    return value;
  }
  return `${value.slice(0, 8)}…${value.slice(-6)}`;
}

function buildStatusBody(
  snapshot: {
    state: PaymentAttemptState;
    updatedAt: string;
    transactionHash: string | null;
    fulfilledResult?: FulfilledStatusResult;
  } | null,
): { status: number; body: SafePaymentStatusBody } {
  if (!snapshot) {
    return {
      status: 404,
      body: { state: "not_seen" },
    };
  }

  if (IN_PROGRESS_STATES.includes(snapshot.state)) {
    return {
      status: 200,
      body: {
        state: snapshot.state,
        updatedAt: snapshot.updatedAt,
      },
    };
  }

  if (snapshot.state === "fulfilled") {
    const body: SafePaymentStatusBody = {
      state: "fulfilled",
      updatedAt: snapshot.updatedAt,
      canRetry: false,
      needsFreshTerms: false,
      transactionReference: snapshot.transactionHash
        ? shortenTransactionRef(snapshot.transactionHash)
        : undefined,
    };
    if (snapshot.fulfilledResult) {
      body.result = snapshot.fulfilledResult;
    }
    return { status: 200, body };
  }

  if (snapshot.state === "failed-definitive") {
    return {
      status: 200,
      body: {
        state: "failed-definitive",
        updatedAt: snapshot.updatedAt,
        needsFreshTerms: true,
        canRetry: false,
      },
    };
  }

  if (snapshot.state === "uncertain") {
    return {
      status: 200,
      body: {
        state: "uncertain",
        updatedAt: snapshot.updatedAt,
        canRetry: false,
        transactionReference: snapshot.transactionHash
          ? shortenTransactionRef(snapshot.transactionHash)
          : undefined,
      },
    };
  }

  return {
    status: 410,
    body: {
      state: "expired",
      needsFreshTerms: true,
      canRetry: false,
    },
  };
}

export async function payStatusHandler(c: Context) {
  const env = c.env as MainnetEnv;
  const paymentIdentifier = c.req.param("paymentIdentifier") ?? "";
  if (!paymentIdentifier || !validatePaymentIdentifierForLookup(paymentIdentifier)) {
    return c.json(
      { state: "not_seen" satisfies SafePaymentStatusBody["state"] },
      404,
      MAINNET_SAFE_RESPONSE_HEADERS,
    );
  }

  const snapshot = await coordinatorGetStatusByPaymentIdentifier(
    env.PAYMENT_COORDINATOR as unknown as DurableObjectNamespace,
    paymentIdentifier,
  );
  const result = buildStatusBody(snapshot);

  return c.json(result.body, result.status as 200 | 404 | 410, MAINNET_SAFE_RESPONSE_HEADERS);
}

export function buildSafePaymentStatusBody(
  snapshot: {
    state: PaymentAttemptState;
    updatedAt: string;
    transactionHash: string | null;
    fulfilledResult?: FulfilledStatusResult;
  } | null,
): SafePaymentStatusBody {
  return buildStatusBody(snapshot).body;
}
