import { createHash } from "node:crypto";
import { readFileSync, existsSync } from "node:fs";
import { join } from "node:path";

export const MAX_BLOB_BYTES = 512 * 1024;

export const SECRET_CATEGORIES = new Set([
  "private-key-material",
  "github-token",
  "openai-key",
  "stripe-live-key",
  "aws-access-key",
  "jwt-credential",
  "credential-url",
  "api-key-assignment",
  "private-key-env",
  "mnemonic-assignment",
  "tracked-secret-file",
]);

export const PRIVACY_CATEGORIES = new Set([
  "absolute-user-path",
  "workers-hostname",
  "personal-email",
  "release-status-contradiction",
]);

export const PLACEHOLDER_WORKERS_HOSTS = new Set([
  "example-subdomain.workers.dev",
  "other-subdomain.workers.dev",
  "x402-worker-template.example-subdomain.workers.dev",
]);

const RULES = [
  {
    category: "private-key-material",
    regex:
      /-----BEGIN (?:RSA |EC |OPENSSH |ENCRYPTED )?PRIVATE KEY-----|-----BEGIN PGP PRIVATE KEY BLOCK-----/g,
  },
  {
    category: "github-token",
    regex: /\b(?:ghp_[A-Za-z0-9]{20,}|github_pat_[A-Za-z0-9_]{20,}|gho_[A-Za-z0-9]{20,})\b/g,
  },
  {
    category: "openai-key",
    regex: /\bsk-[A-Za-z0-9]{20,}\b/g,
  },
  {
    category: "stripe-live-key",
    regex: /\bsk_live_[A-Za-z0-9]{10,}\b/g,
  },
  {
    category: "aws-access-key",
    regex: /\bAKIA[0-9A-Z]{16}\b/g,
  },
  {
    category: "jwt-credential",
    regex: /\beyJ[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}\b/g,
  },
  {
    category: "credential-url",
    regex: /https?:\/\/[^/\s:@]+:[^/\s@]+@[^\s"'`]+/gi,
    validate(match) {
      if (/example\.com/i.test(match)) return false;
      if (/example-subdomain\.workers\.dev/i.test(match)) return false;
      return true;
    },
  },
  {
    category: "api-key-assignment",
    regex:
      /\b(?:api[_-]?key|client[_-]?secret|access[_-]?token)\s*[:=]\s*['"]?[A-Za-z0-9._-]{8,}/gi,
    validate(match) {
      if (/should-not-appear|example|fake|test-only|redacted/i.test(match)) {
        return false;
      }
      return true;
    },
  },
  {
    category: "private-key-env",
    regex: /\bEVM_PRIVATE_KEY\s*=\s*['"]?(?!['"]?\s*['"]?$)0x[0-9a-fA-F]{64}\b/gi,
  },
  {
    category: "mnemonic-assignment",
    regex:
      /\b(?:mnemonic|seed phrase|seed_phrase)\s*[:=]\s*['"]?[A-Za-z0-9 ,]{20,}/gi,
  },
  {
    category: "absolute-user-path",
    regex: /(?:[A-Z]:\\Users\\|\/Users\/|\/home\/[^/\s]+\/)/g,
  },
  {
    category: "workers-hostname",
    regex: /\b[a-z0-9-]+(?:\.[a-z0-9-]+)*\.workers\.dev\b/gi,
    validate(match, content, offset) {
      const hostname = match.toLowerCase();
      if (PLACEHOLDER_WORKERS_HOSTS.has(hostname)) {
        return false;
      }
      if (hostname.includes("example-subdomain")) {
        return false;
      }
      if (content.slice(Math.max(0, offset - 20), offset).includes("<")) {
        return false;
      }
      return true;
    },
  },
  {
    category: "personal-email",
    regex: /\b[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}\b/g,
    validate(match, content, offset) {
      const lower = match.toLowerCase();
      if (lower.endsWith("@example.com")) return false;
      if (lower.endsWith("@users.noreply.github.com")) return false;
      if (lower.includes(".workers.dev")) return false;
      const before = content.slice(Math.max(0, offset - 24), offset);
      if (/[:/][^/\s]*$/.test(before)) return false;
      return true;
    },
  },
];

const TRACKED_SECRET_FILE_PATTERNS = [
  /^\.env$/,
  /^\.env\./,
  /^\.dev\.vars$/,
  /^\.dev\.vars\./,
  /^\.npmrc$/,
  /^.*\.key$/,
  /^.*\.pem$/,
  /^.*\.p12$/,
  /^.*\.pfx$/,
  /^.*\.jks$/,
  /^.*\.keystore$/,
  /^.*\.wallet$/,
  /^.*\.seed$/,
];

export function sha256(value) {
  return createHash("sha256").update(value, "utf8").digest("hex");
}

export function redactPreview(value, category) {
  if (!value) return "[empty]";
  if (category === "personal-email") {
    const at = value.indexOf("@");
    if (at <= 1) return "[REDACTED-EMAIL]";
    return `${value.slice(0, 1)}…${value.slice(at)}`;
  }
  if (value.length <= 8) return "[REDACTED]";
  return `${value.slice(0, 4)}…${value.slice(-4)} (${value.length} chars)`;
}

export function loadAllowlist(repoRoot) {
  const path = join(repoRoot, ".security-scan-allowlist.json");
  if (!existsSync(path)) {
    return [];
  }
  const parsed = JSON.parse(readFileSync(path, "utf8"));
  if (!Array.isArray(parsed)) {
    throw new Error(".security-scan-allowlist.json must be a JSON array");
  }
  return parsed;
}

export function validateAllowlistEntries(entries) {
  const seen = new Set();
  for (const entry of entries) {
    for (const field of ["path", "category", "sha256", "reason", "scope"]) {
      if (!entry[field]) {
        throw new Error(`Allowlist entry missing ${field}`);
      }
    }
    if (!["tracked", "history", "both"].includes(entry.scope)) {
      throw new Error(`Invalid allowlist scope: ${entry.scope}`);
    }
    const key = `${entry.path}|${entry.category}|${entry.sha256}|${entry.scope}`;
    if (seen.has(key)) {
      throw new Error(`Duplicate allowlist entry: ${key}`);
    }
    seen.add(key);
  }
}

export function isTrackedSecretFile(relativePath) {
  const normalized = relativePath.replace(/\\/g, "/");
  if (normalized.endsWith(".example")) {
    return false;
  }
  return TRACKED_SECRET_FILE_PATTERNS.some((pattern) => pattern.test(normalized));
}

export function isLikelyBinary(buffer) {
  const sample = buffer.subarray(0, Math.min(buffer.length, 8192));
  let suspicious = 0;
  for (const byte of sample) {
    if (byte === 0) return true;
    if (byte < 9 || (byte > 13 && byte < 32)) suspicious += 1;
  }
  return suspicious / sample.length > 0.3;
}

export function scanTextContent(content, context = {}) {
  const findings = [];
  const relativePath = context.path ?? "<unknown>";
  const normalizedPath = relativePath.replace(/\\/g, "/");
  const scannerDefinitionFile = normalizedPath.endsWith(
    "scripts/lib/security-scan-core.mjs",
  );

  if (context.scope === "tracked" && isTrackedSecretFile(relativePath)) {
    findings.push({
      category: "tracked-secret-file",
      path: relativePath,
      commit: context.commit,
      object: context.object,
      match: relativePath,
      matchSha256: sha256(relativePath),
      preview: redactPreview(relativePath, "tracked-secret-file"),
    });
  }

  for (const rule of RULES) {
    if (scannerDefinitionFile && rule.category === "absolute-user-path") {
      continue;
    }
    rule.regex.lastIndex = 0;
    let match;
    while ((match = rule.regex.exec(content)) !== null) {
      const value = match[0];
      if (rule.category === "private-key-env" && value.includes("0xabc")) {
        continue;
      }
      if (
        rule.validate &&
        !rule.validate(value, content, match.index, relativePath)
      ) {
        continue;
      }
      if (isBenignTransactionHash(value, content, match.index, rule.category)) {
        continue;
      }
      findings.push({
        category: rule.category,
        path: relativePath,
        commit: context.commit,
        object: context.object,
        match: value,
        matchSha256: sha256(value),
        preview: redactPreview(value, rule.category),
      });
    }
  }

  return findings;
}

function isBenignTransactionHash(value, content, offset, category) {
  if (!/^0x[0-9a-fA-F]{64}$/.test(value)) {
    return false;
  }
  if (category === "private-key-env") {
    return false;
  }
  const contextWindow = content.slice(Math.max(0, offset - 40), offset + value.length + 40);
  return /transaction|tx hash|txHash|hash requires|0x plus 64 hex/i.test(contextWindow);
}

export function applyAllowlist(findings, allowlist, scope) {
  const approved = [];
  const unapproved = [];
  const used = new Set();

  for (const finding of findings) {
    const match = allowlist.find(
      (entry) =>
        (entry.scope === scope || entry.scope === "both") &&
        entry.path === finding.path &&
        entry.category === finding.category &&
        entry.sha256 === finding.matchSha256,
    );
    if (match) {
      used.add(`${match.path}|${match.category}|${match.sha256}|${match.scope}`);
      approved.push({ ...finding, allowReason: match.reason });
    } else {
      unapproved.push(finding);
    }
  }

  const unused = allowlist.filter((entry) => {
    if (entry.scope !== scope && entry.scope !== "both") {
      return false;
    }
    const key = `${entry.path}|${entry.category}|${entry.sha256}|${entry.scope}`;
    return !used.has(key);
  });

  return { approved, unapproved, unused };
}

export function classifyHistory(findings) {
  const unapproved = findings.filter((finding) => !finding.allowlisted);
  if (unapproved.some((finding) => SECRET_CATEGORIES.has(finding.category))) {
    return "HISTORY CONTAINS SECRET — ROTATION AND REWRITE REQUIRED";
  }
  if (unapproved.some((finding) => PRIVACY_CATEGORIES.has(finding.category))) {
    return "HISTORY CONTAINS PRIVACY-ONLY FINDINGS — REWRITE REQUIRED";
  }
  return "HISTORY CLEAN";
}

export function formatFinding(finding) {
  const parts = [
    `[${finding.category}]`,
    `path=${finding.path}`,
  ];
  if (finding.commit) parts.push(`commit=${finding.commit.slice(0, 12)}`);
  if (finding.object) parts.push(`object=${finding.object.slice(0, 12)}`);
  parts.push(`sha256=${finding.matchSha256}`);
  parts.push(`preview=${finding.preview}`);
  return parts.join(" ");
}
