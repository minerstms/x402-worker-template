export const MAINNET_PENDING_PAYMENT_SESSION_KEY =
  "x402-mainnet-pending-payment-v1" as const;

export const MAINNET_SESSION_MAX_AGE_MS = 24 * 60 * 60 * 1000;

export type PendingMainnetPaymentSession = {
  version: 1;
  paymentIdentifier: string;
  queryValue: string;
  routePath: string;
  createdAt: string;
  state: "submitted" | "potentially-submitted";
};

export type SessionStorageLike = Pick<Storage, "getItem" | "setItem" | "removeItem">;

export function savePendingMainnetPaymentSession(
  storage: SessionStorageLike,
  session: PendingMainnetPaymentSession,
): void {
  storage.setItem(MAINNET_PENDING_PAYMENT_SESSION_KEY, JSON.stringify(session));
}

export function clearPendingMainnetPaymentSession(
  storage: SessionStorageLike,
): void {
  storage.removeItem(MAINNET_PENDING_PAYMENT_SESSION_KEY);
}

export function readPendingMainnetPaymentSession(
  storage: SessionStorageLike,
  options: {
    now?: number;
    expectedRoutePath?: string;
    expectedQueryValue?: string;
  } = {},
): PendingMainnetPaymentSession | null {
  const raw = storage.getItem(MAINNET_PENDING_PAYMENT_SESSION_KEY);
  if (!raw) {
    return null;
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    clearPendingMainnetPaymentSession(storage);
    return null;
  }

  if (!isValidPendingSession(parsed)) {
    clearPendingMainnetPaymentSession(storage);
    return null;
  }

  const now = options.now ?? Date.now();
  const createdAtMs = Date.parse(parsed.createdAt);
  if (Number.isNaN(createdAtMs) || now - createdAtMs > MAINNET_SESSION_MAX_AGE_MS) {
    clearPendingMainnetPaymentSession(storage);
    return null;
  }

  if (
    options.expectedRoutePath &&
    parsed.routePath !== options.expectedRoutePath
  ) {
    clearPendingMainnetPaymentSession(storage);
    return null;
  }

  if (
    options.expectedQueryValue &&
    parsed.queryValue !== options.expectedQueryValue
  ) {
    clearPendingMainnetPaymentSession(storage);
    return null;
  }

  return parsed;
}

function isValidPendingSession(
  value: unknown,
): value is PendingMainnetPaymentSession {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return false;
  }
  const session = value as PendingMainnetPaymentSession;
  return (
    session.version === 1 &&
    typeof session.paymentIdentifier === "string" &&
    session.paymentIdentifier.length >= 16 &&
    typeof session.queryValue === "string" &&
    typeof session.routePath === "string" &&
    typeof session.createdAt === "string" &&
    (session.state === "submitted" || session.state === "potentially-submitted")
  );
}

export function shortenPaymentIdentifier(value: string): string {
  if (value.length <= 12) {
    return value;
  }
  return `${value.slice(0, 6)}…${value.slice(-4)}`;
}
