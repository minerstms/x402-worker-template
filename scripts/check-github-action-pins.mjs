#!/usr/bin/env node
import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";

const repoRoot = process.cwd();
const manifestPath = join(repoRoot, ".github", "action-pins.json");
const workflowsDir = join(repoRoot, ".github", "workflows");
const FULL_SHA = /^[0-9a-f]{40}$/;

function loadManifest() {
  const manifest = JSON.parse(readFileSync(manifestPath, "utf8"));
  for (const [action, entry] of Object.entries(manifest)) {
    if (!entry?.tag || !entry?.sha) {
      throw new Error(`Manifest entry for ${action} must include tag and sha.`);
    }
    if (!FULL_SHA.test(entry.sha)) {
      throw new Error(`Manifest SHA for ${action} must be a 40-character lowercase hex string.`);
    }
  }
  return manifest;
}

function listWorkflowFiles() {
  return readdirSync(workflowsDir)
    .filter((name) => name.endsWith(".yml") || name.endsWith(".yaml"))
    .map((name) => join(workflowsDir, name));
}

function parseUsesReferences(content, filePath) {
  const references = [];
  const lines = content.split(/\r?\n/);
  for (let index = 0; index < lines.length; index += 1) {
    const line = lines[index];
    const match = line.match(/^\s*(?:-\s+)?uses:\s*(.+?)\s*$/);
    if (!match) continue;
    references.push({
      filePath,
      lineNumber: index + 1,
      line,
      reference: match[1].trim(),
    });
  }
  return references;
}

function parseExternalAction(reference) {
  if (reference.startsWith("./")) {
    return { kind: "local" };
  }
  const commentMatch = reference.match(/^([^#]+)(?:#\s*(.+))?$/);
  const actionRef = commentMatch?.[1]?.trim() ?? reference;
  const comment = commentMatch?.[2]?.trim() ?? "";
  const atIndex = actionRef.lastIndexOf("@");
  if (atIndex === -1) {
    return { kind: "invalid", reason: "missing @ separator" };
  }
  const action = actionRef.slice(0, atIndex);
  const pin = actionRef.slice(atIndex + 1);
  return { kind: "external", action, pin, comment };
}

function main() {
  const manifest = loadManifest();
  const reviewedActions = new Set(Object.keys(manifest));
  const seenExternal = new Set();
  const errors = [];

  for (const workflowPath of listWorkflowFiles()) {
    const content = readFileSync(workflowPath, "utf8");
    for (const ref of parseUsesReferences(content, workflowPath)) {
      const parsed = parseExternalAction(ref.reference);
      if (parsed.kind === "local") {
        continue;
      }
      if (parsed.kind === "invalid") {
        errors.push(`${ref.filePath}:${ref.lineNumber} invalid uses reference (${parsed.reason})`);
        continue;
      }

      seenExternal.add(parsed.action);
      if (!reviewedActions.has(parsed.action)) {
        errors.push(`${ref.filePath}:${ref.lineNumber} unreviewed external action ${parsed.action}`);
        continue;
      }

      const expected = manifest[parsed.action];
      if (!FULL_SHA.test(parsed.pin)) {
        if (/^v\d/i.test(parsed.pin)) {
          errors.push(`${ref.filePath}:${ref.lineNumber} mutable tag pin ${parsed.action}@${parsed.pin}`);
        } else if (/^[0-9a-f]{1,39}$/i.test(parsed.pin) || /^[0-9a-f]{41,}$/i.test(parsed.pin)) {
          errors.push(`${ref.filePath}:${ref.lineNumber} invalid SHA length for ${parsed.action}`);
        } else {
          errors.push(`${ref.filePath}:${ref.lineNumber} non-SHA pin for ${parsed.action}: ${parsed.pin}`);
        }
        continue;
      }

      if (parsed.pin !== expected.sha) {
        errors.push(
          `${ref.filePath}:${ref.lineNumber} ${parsed.action} SHA mismatch (expected ${expected.sha}, found ${parsed.pin})`,
        );
      }

      const expectedComment = expected.tag;
      if (parsed.comment !== expectedComment) {
        errors.push(
          `${ref.filePath}:${ref.lineNumber} ${parsed.action} tag comment mismatch (expected ${expectedComment}, found ${parsed.comment || "<missing>"})`,
        );
      }
    }
  }

  for (const action of reviewedActions) {
    if (!seenExternal.has(action)) {
      errors.push(`Manifest action ${action} is not referenced by any workflow`);
    }
  }

  if (errors.length > 0) {
    console.error("GitHub action pin check failed:");
    for (const error of errors) {
      console.error(`- ${error}`);
    }
    process.exit(1);
  }

  console.log("GitHub action pin check: PASS");
  for (const [action, entry] of Object.entries(manifest)) {
    console.log(`- ${action}@${entry.sha} # ${entry.tag}`);
  }
}

main();
