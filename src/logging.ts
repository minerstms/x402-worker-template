const REDACT_KEY_PATTERN =
  /(authorization|private|secret|signature|seed|mnemonic|token|api[_-]?key|payment-signature|payment-required)/i;

const REDACTED = "[REDACTED]";

export type LogLevel = "info" | "warn" | "error";

export type SafeLogFields = {
  requestId?: string;
  route?: string;
  method?: string;
  status?: number;
  durationMs?: number;
  upstreamStatus?: number;
  paymentOutcome?: string;
  settlementTxHash?: string;
  message?: string;
  code?: string;
  [key: string]: unknown;
};

export function shouldRedactKey(key: string): boolean {
  return REDACT_KEY_PATTERN.test(key);
}

export function redactValue(value: unknown, key?: string): unknown {
  if (key !== undefined && shouldRedactKey(key)) {
    return REDACTED;
  }
  if (value === null || value === undefined) {
    return value;
  }
  if (Array.isArray(value)) {
    return value.map((item) => redactValue(item));
  }
  if (typeof value === "object") {
    const out: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(value as Record<string, unknown>)) {
      out[k] = shouldRedactKey(k) ? REDACTED : redactValue(v, k);
    }
    return out;
  }
  return value;
}

export function createRequestId(): string {
  return crypto.randomUUID();
}

export function logStructured(
  level: LogLevel,
  fields: SafeLogFields,
  writer: (line: string) => void = defaultWriter,
): void {
  const safe = redactValue(fields) as SafeLogFields;
  const line = JSON.stringify({
    level,
    ts: new Date().toISOString(),
    ...safe,
  });
  writer(line);
}

function defaultWriter(line: string): void {
  if (line.includes('"level":"error"') || line.includes('"level":"warn"')) {
    console.error(line);
  } else {
    console.log(line);
  }
}
