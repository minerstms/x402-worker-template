export class CanonicalJsonError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "CanonicalJsonError";
  }
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  if (value === null || typeof value !== "object" || Array.isArray(value)) {
    return false;
  }
  const prototype = Object.getPrototypeOf(value);
  return prototype === Object.prototype || prototype === null;
}

function serializeCanonicalValue(value: unknown): string {
  if (value === null) {
    return "null";
  }

  const valueType = typeof value;
  if (valueType === "string") {
    return JSON.stringify(value);
  }
  if (valueType === "boolean") {
    return value ? "true" : "false";
  }
  if (valueType === "number") {
    if (!Number.isFinite(value as number)) {
      throw new CanonicalJsonError("Unsupported numeric value");
    }
    return JSON.stringify(value);
  }
  if (valueType === "bigint" || valueType === "function" || valueType === "symbol") {
    throw new CanonicalJsonError(`Unsupported value type: ${valueType}`);
  }
  if (valueType === "undefined") {
    throw new CanonicalJsonError("Unsupported value: undefined");
  }

  if (Array.isArray(value)) {
    const items = value.map((entry) => serializeCanonicalValue(entry));
    return `[${items.join(",")}]`;
  }

  if (!isPlainObject(value)) {
    throw new CanonicalJsonError("Unsupported object value");
  }

  const keys = Object.keys(value).sort();
  const entries = keys.map((key) => {
    const entryValue = value[key];
    if (entryValue === undefined) {
      throw new CanonicalJsonError(`Unsupported undefined property: ${key}`);
    }
    return `${JSON.stringify(key)}:${serializeCanonicalValue(entryValue)}`;
  });
  return `{${entries.join(",")}}`;
}

export function canonicalizeJsonValue(value: unknown): string {
  return serializeCanonicalValue(value);
}

export async function sha256Hex(input: string): Promise<string> {
  const data = new TextEncoder().encode(input);
  const digest = await crypto.subtle.digest("SHA-256", data);
  return [...new Uint8Array(digest)]
    .map((byte) => byte.toString(16).padStart(2, "0"))
    .join("");
}
