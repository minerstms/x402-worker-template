export const MAX_BLOB_BYTES: number;

export const SECRET_CATEGORIES: ReadonlySet<string>;
export const PRIVACY_CATEGORIES: ReadonlySet<string>;

export type ScanFinding = {
  category: string;
  path: string;
  commit?: string;
  object?: string;
  match: string;
  matchSha256: string;
  preview: string;
  allowlisted?: boolean;
  allowReason?: string;
};

export type AllowlistEntry = {
  path: string;
  category: string;
  sha256: string;
  reason: string;
  scope: "tracked" | "history" | "both";
};

export function sha256(value: string): string;
export function redactPreview(value: string, category: string): string;
export function loadAllowlist(repoRoot: string): AllowlistEntry[];
export function validateAllowlistEntries(entries: AllowlistEntry[]): void;
export function scanTextContent(
  content: string,
  context?: {
    path?: string;
    commit?: string;
    object?: string;
    scope?: "tracked" | "history";
  },
): ScanFinding[];
export function applyAllowlist(
  findings: ScanFinding[],
  allowlist: AllowlistEntry[],
  scope: "tracked" | "history",
): {
  approved: ScanFinding[];
  unapproved: ScanFinding[];
  unused: AllowlistEntry[];
};
export function classifyHistory(findings: ScanFinding[]): string;
export function formatFinding(finding: ScanFinding): string;
