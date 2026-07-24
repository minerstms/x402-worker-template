import type { SafePaymentStatusBody } from "../routes/pay-status.js";

export type PaymentStatusFetchResult =
  | { ok: true; status: number; body: SafePaymentStatusBody }
  | { ok: false; reason: string };

export async function fetchPaymentStatus(options: {
  fetchImpl: typeof fetch;
  origin: string;
  paymentIdentifier: string;
}): Promise<PaymentStatusFetchResult> {
  const url = new URL(
    `/pay/status/${encodeURIComponent(options.paymentIdentifier)}`,
    options.origin,
  ).toString();

  let response: Response;
  try {
    response = await options.fetchImpl(url, {
      method: "GET",
      headers: { Accept: "application/json" },
      redirect: "error",
      cache: "no-store",
    });
  } catch {
    return { ok: false, reason: "Status lookup failed." };
  }

  let body: unknown;
  try {
    body = await response.json();
  } catch {
    return { ok: false, reason: "Status response was not JSON." };
  }

  if (!isSafePaymentStatusBody(body)) {
    return { ok: false, reason: "Status response shape is invalid." };
  }

  return { ok: true, status: response.status, body };
}

function isSafePaymentStatusBody(value: unknown): value is SafePaymentStatusBody {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return false;
  }
  const candidate = value as SafePaymentStatusBody;
  return typeof candidate.state === "string";
}
