const REDACT_KEY_PATTERN =
  /(authorization|private|secret|signature|seed|mnemonic|token|api[_-]?key|payment-signature|payment-required|payment-identifier|wallet|nonce|payload)/i;

const REDACTED = "[REDACTED]";

const ALLOWED_LOG_FIELD_KEYS = [
  "requestId",
  "route",
  "method",
  "status",
  "durationMs",
  "upstreamStatus",
  "paymentOutcome",
  "code",
  "message",
] as const;

export type LogLevel = "info" | "warn" | "error";

export type SafeLogFields = {
  requestId?: string;
  route?: string;
  method?: string;
  status?: number;
  durationMs?: number;
  upstreamStatus?: number;
  paymentOutcome?: string;
  code?: string;
  message?: string;
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

function pickAllowedLogFields(fields: SafeLogFields): SafeLogFields {
  const out: SafeLogFields = {};
  for (const key of ALLOWED_LOG_FIELD_KEYS) {
    const value = fields[key];
    if (value !== undefined) {
      out[key] = value;
    }
  }
  return out;
}

export function createRequestId(): string {
  return crypto.randomUUID();
}

export function logStructured(
  level: LogLevel,
  fields: SafeLogFields,
  writer: (line: string) => void = defaultWriter,
): void {
  const safe = redactValue(pickAllowedLogFields(fields)) as SafeLogFields;
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

export function getAllowedLogFieldKeys(): readonly string[] {
  return ALLOWED_LOG_FIELD_KEYS;
}
