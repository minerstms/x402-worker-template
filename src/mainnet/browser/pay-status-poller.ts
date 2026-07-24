import type { SafePaymentStatusBody } from "../routes/pay-status.js";
import { fetchPaymentStatus } from "./pay-status-client.js";

export type StatusPollPolicy = {
  intervalMs: number;
  maxPolls: number;
};

export type StatusPollCallbacks = {
  onPoll?: (pollCount: number, body: SafePaymentStatusBody) => void;
  onInProgress?: (state: SafePaymentStatusBody["state"], pollCount: number) => void;
};

export type StatusPollResult =
  | { kind: "fulfilled"; body: SafePaymentStatusBody; pollCount: number }
  | { kind: "failed-definitive"; body: SafePaymentStatusBody; pollCount: number }
  | { kind: "expired"; body: SafePaymentStatusBody; pollCount: number }
  | { kind: "uncertain"; body: SafePaymentStatusBody; pollCount: number }
  | { kind: "not_seen_limit"; pollCount: number }
  | { kind: "malformed"; reason: string; pollCount: number }
  | { kind: "cancelled"; pollCount: number };

export type TimerScheduler = {
  now: () => number;
  setTimeout: (fn: () => void, ms: number) => unknown;
  clearTimeout: (handle: unknown) => void;
};

export const defaultStatusPollPolicy: StatusPollPolicy = {
  intervalMs: 1000,
  maxPolls: 10,
};

export const defaultTimerScheduler: TimerScheduler = {
  now: () => Date.now(),
  setTimeout: (fn, ms) => setTimeout(fn, ms),
  clearTimeout: (handle) => clearTimeout(handle as ReturnType<typeof setTimeout>),
};

const IN_PROGRESS_STATES = new Set<SafePaymentStatusBody["state"]>([
  "reserved",
  "verifying",
  "verified",
  "computing",
  "settling",
]);

export async function pollPaymentStatus(options: {
  fetchImpl: typeof fetch;
  origin: string;
  paymentIdentifier: string;
  policy?: StatusPollPolicy;
  scheduler?: TimerScheduler;
  signal?: AbortSignal;
  callbacks?: StatusPollCallbacks;
}): Promise<StatusPollResult> {
  const policy = options.policy ?? defaultStatusPollPolicy;
  const scheduler = options.scheduler ?? defaultTimerScheduler;
  let pollCount = 0;

  while (pollCount < policy.maxPolls) {
    if (options.signal?.aborted) {
      return { kind: "cancelled", pollCount };
    }

    pollCount += 1;
    const lookup = await fetchPaymentStatus({
      fetchImpl: options.fetchImpl,
      origin: options.origin,
      paymentIdentifier: options.paymentIdentifier,
    });

    if (!lookup.ok) {
      return { kind: "malformed", reason: lookup.reason, pollCount };
    }

    options.callbacks?.onPoll?.(pollCount, lookup.body);

    const state = lookup.body.state;
    if (state === "fulfilled") {
      return { kind: "fulfilled", body: lookup.body, pollCount };
    }
    if (state === "failed-definitive") {
      return { kind: "failed-definitive", body: lookup.body, pollCount };
    }
    if (state === "expired") {
      return { kind: "expired", body: lookup.body, pollCount };
    }
    if (state === "uncertain") {
      return { kind: "uncertain", body: lookup.body, pollCount };
    }
    if (IN_PROGRESS_STATES.has(state)) {
      options.callbacks?.onInProgress?.(state, pollCount);
    }

    if (pollCount >= policy.maxPolls) {
      if (state === "not_seen") {
        return { kind: "not_seen_limit", pollCount };
      }
      break;
    }

    await waitForInterval(scheduler, policy.intervalMs, options.signal);
  }

  return { kind: "not_seen_limit", pollCount };
}

function waitForInterval(
  scheduler: TimerScheduler,
  ms: number,
  signal?: AbortSignal,
): Promise<void> {
  if (signal?.aborted) {
    return Promise.resolve();
  }
  return new Promise((resolve) => {
    const handle = scheduler.setTimeout(() => resolve(), ms);
    signal?.addEventListener(
      "abort",
      () => {
        scheduler.clearTimeout(handle);
        resolve();
      },
      { once: true },
    );
  });
}
