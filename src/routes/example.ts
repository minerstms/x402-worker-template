import type { Context, Next } from "hono";
import { invalidValue, missingValue } from "../errors.js";
import { logStructured } from "../logging.js";
import { SERVICE_ID } from "../config.js";
import type { AppEnv } from "../config.js";

export type ExampleDeps = {
  onHandlerExecuted?: () => void;
  now?: () => Date;
};

/** Technical abuse-control limit — not a domain constraint. */
export const EXAMPLE_VALUE_MAX_LENGTH = 256;

export function isValidExampleValue(raw: string): boolean {
  if (raw !== raw.trim()) return false;
  if (raw.length === 0) return false;
  if (raw.length > EXAMPLE_VALUE_MAX_LENGTH) return false;
  return true;
}

/**
 * Validate `value` before payment middleware runs.
 * Rejects missing, blank, whitespace-padded, oversized, duplicate, and
 * unexpected query parameters. Does not call external services.
 */
export async function validateExampleQuery(
  c: Context<{ Bindings: AppEnv; Variables: { requestId: string } }>,
  next: Next,
) {
  const requestId = c.get("requestId");
  const url = new URL(c.req.url);
  const queryKeys = [...url.searchParams.keys()];

  if (queryKeys.length !== 1 || queryKeys[0] !== "value") {
    return c.json(invalidValue(requestId), 400);
  }

  const values = url.searchParams.getAll("value");
  if (values.length === 0) {
    return c.json(missingValue(requestId), 400);
  }
  if (values.length > 1) {
    return c.json(invalidValue(requestId), 400);
  }

  const value = values[0]!;
  if (!isValidExampleValue(value)) {
    return c.json(invalidValue(requestId), 400);
  }

  c.set("exampleValue" as never, value as never);
  await next();
}

export function buildExampleResponse(
  value: string,
  now: () => Date = () => new Date(),
) {
  const normalizedInput = value.trim();
  return {
    success: true as const,
    input: value,
    normalizedInput,
    characterCount: normalizedInput.length,
    service: {
      id: SERVICE_ID,
      name: "x402 Paid Worker Template",
      retrievedAt: now().toISOString(),
    },
  };
}

export function createExampleHandler(deps: ExampleDeps = {}) {
  return async function exampleHandler(
    c: Context<{
      Bindings: AppEnv;
      Variables: { requestId: string; exampleValue?: string };
    }>,
  ) {
    deps.onHandlerExecuted?.();
    const requestId = c.get("requestId");
    const url = new URL(c.req.url);
    const value = url.searchParams.get("value");

    if (!value || !isValidExampleValue(value)) {
      return c.json(invalidValue(requestId), 400);
    }

    logStructured("info", {
      requestId,
      route: "/v1/example",
      method: "GET",
      status: 200,
      paymentOutcome: "handler_executed_after_verification",
    });

    return c.json(buildExampleResponse(value, deps.now ?? (() => new Date())), 200);
  };
}
