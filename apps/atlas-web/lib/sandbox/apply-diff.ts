import parseDiffLib from "parse-diff";
import type { FileOp, FileApplyResult, SandboxFileSystemLike, ApplyDiffResult } from "./apply-diff-types";
import { annotateAtlasIds } from "@atlas/edit-patch-engine";

const DEFAULT_ROOT = "/code";

/**
 * Ensure the sandbox's root RootLayout keeps `<AtlasEditBridge />` mounted.
 *
 * The Developer LLM regularly rewrites `src/app/layout.tsx` from scratch
 * and drops the bridge mount that streams the editable DOM tree to the
 * parent window. Without the bridge, IframeOverlay receives no
 * `atlas-dom-tree` messages and renders zero hit-zones — click-to-edit
 * silently breaks for every redeploy.
 *
 * Idempotent: leaves content untouched if `AtlasEditBridge` already
 * appears in the file. Only rewrites the root `app/layout.tsx`; nested
 * layouts and unrelated .tsx files are passed through verbatim.
 */
export function ensureAtlasEditBridge(absPath: string, content: string): string {
  if (!/\/app\/layout\.tsx$/.test(absPath)) return content;
  if (/AtlasEditBridge/.test(content)) return content;

  const importLine = `import { AtlasEditBridge } from "../atlas-edit-bridge";`;
  const importRe = /^(import\s[^\n]+;\s*\n)+/m;
  let next = content;
  if (importRe.test(next)) {
    next = next.replace(importRe, (m) => `${m}${importLine}\n`);
  } else {
    next = `${importLine}\n${next}`;
  }

  const bodyOpenRe = /(<body\b[^>]*>)/;
  if (bodyOpenRe.test(next)) {
    next = next.replace(bodyOpenRe, (_m, open: string) => `${open}\n        <AtlasEditBridge />`);
  }
  return next;
}

/** Parses a unified diff into per-file operations. Wraps the parse-diff
 *  npm library with our internal FileOp shape (which sanitizes paths
 *  and normalizes the create/modify/delete kind classification). */
export function parseDiff(diff: string): { ops: FileOp[]; error?: string } {
  if (!diff || !diff.trim()) {
    return { ops: [] };
  }

  // D14 capture hook — gated on ATLAS_DEBUG_CAPTURE_DIFFS=true so it
  // never runs in production. Writes the RAW diff string (pre-repair,
  // pre-parse) to a temp file so we can replay the bytes exactly as
  // the LLM produced them. Use this only when reproducing the
  // apply-diff-multi-file-leak (D14) failure pattern on a live ritual.
  captureRawDiffForDebug(diff);

  // LLM-generated diffs frequently mis-state the hunk-header line count
  // for /dev/null creates: `@@ -0,0 +1,52 @@` followed by 54 `+` lines.
  // parse-diff respects the declared count and silently truncates the
  // file to N lines, dropping the closing braces and producing
  // syntactically invalid TypeScript at the sandbox. Repair the headers
  // before parse-diff sees them so the full content always lands.
  diff = repairCreateHunkCounts(diff);

  let parsed: ReturnType<typeof parseDiffLib>;
  try {
    parsed = parseDiffLib(diff);
  } catch (err) {
    return { ops: [], error: `parse-diff threw: ${(err as Error).message}` };
  }

  const ops: FileOp[] = [];
  for (const file of parsed) {
    const kind = classifyKind(file);
    const rawPath = pickPath(file, kind);
    if (!rawPath) continue; // skip files we can't identify (rare; malformed input)
    const path = stripGitPrefix(rawPath);
    if (kind === "create") {
      const newContent = collectAddedLines(file);
      ops.push({ kind, path, newContent });
    } else if (kind === "delete") {
      ops.push({ kind, path });
    } else {
      // modify: keep the parsed chunks for applyFileOp to reconstruct against
      ops.push({ kind, path, _chunks: file.chunks });
    }
  }

  return { ops };
}

/**
 * Walk a unified diff line-by-line and rewrite `@@ -0,0 +1,N @@` headers
 * so N matches the actual count of `+` lines in the chunk that follows.
 * Touches ONLY new-file-from-/dev/null hunks (the `-0,0` shape) so we
 * don't fight context-line counting on real modifies.
 *
 * The chunk ends at the next line starting with ANY recognised file-
 * header marker — `@@`, `diff --git`, `index abc..def`, `Index:`,
 * `--- `, `+++ `, `new file mode`, `deleted file mode` — OR end of
 * input. We have to terminate on `+++ ` (and the bare mode/index
 * markers) too: when the LLM omits the standard `diff --git` /
 * `--- /dev/null` separators between files, the next file's `+++ b/path`
 * is the only line that signals the boundary, and since it starts with
 * `+` the count walk would otherwise include it as a `+` content line.
 */
export function repairCreateHunkCounts(diff: string): string {
  const lines = diff.split("\n");
  const HEADER_RE = /^@@\s+-0,0\s+\+1,(\d+)\s+@@/;
  // Boundary invariant: the walk MUST stop at the first line of the next
  // file's section in any diff dialect — otherwise the synthesized N
  // covers the next file's body and parse-diff bleeds it into the
  // current chunk's `add` changes (D14).
  const CHUNK_END_RE = /^(@@|diff --git |index [\da-zA-Z]+\.\.|Index: |--- |\+\+\+ |new file mode |deleted file mode )/;

  for (let i = 0; i < lines.length; i++) {
    const m = HEADER_RE.exec(lines[i]!);
    if (!m) continue;
    const declared = Number(m[1]);
    let added = 0;
    let j = i + 1;
    while (j < lines.length && !CHUNK_END_RE.test(lines[j]!)) {
      if (lines[j]!.startsWith("+")) added++;
      j++;
    }
    if (added !== declared) {
      lines[i] = lines[i]!.replace(HEADER_RE, `@@ -0,0 +1,${added} @@`);
    }
  }
  return lines.join("\n");
}

function classifyKind(file: parseDiffLib.File): FileOp["kind"] {
  if (file.new) return "create";
  if (file.deleted) return "delete";
  // Fallback: if `from` is /dev/null it's create; if `to` is /dev/null it's delete
  if (file.from === "/dev/null") return "create";
  if (file.to === "/dev/null") return "delete";
  return "modify";
}

function pickPath(file: parseDiffLib.File, kind: FileOp["kind"]): string | undefined {
  // For create: only `to` is meaningful. For delete: only `from`. For modify:
  // either works (they're the same) — prefer `to` since that's the post-image.
  if (kind === "delete") return file.from;
  return file.to;
}

function stripGitPrefix(p: string): string {
  if (p.startsWith("a/") || p.startsWith("b/")) return p.slice(2);
  return p;
}

function collectAddedLines(file: parseDiffLib.File): string {
  const lines: string[] = [];
  for (const chunk of file.chunks) {
    for (const change of chunk.changes) {
      if (change.type === "add") lines.push(change.content.slice(1)); // strip leading "+"
    }
  }
  // Preserve a trailing newline if the diff's last hunk doesn't end with
  // the "no newline" sentinel (parse-diff doesn't expose this directly,
  // but trailing \n is the safe default for source files)
  return lines.join("\n") + (lines.length > 0 ? "\n" : "");
}

/** Sanitize a diff-supplied path against the apply rootDir.
 *  Returns the absolute (rooted) path on success, or null when the
 *  input is unsafe (absolute, escapes root, contains null bytes, etc.).
 *
 *  Posix-style paths only — sandbox files live in a Linux container.
 */
export function sanitizePath(rawPath: string, rootDir: string): string | null {
  if (!rawPath || rawPath.includes("\0")) return null;
  // Strip git's a/ or b/ prefix (parse-diff sometimes leaves it)
  let p = rawPath;
  if (p.startsWith("a/") || p.startsWith("b/")) p = p.slice(2);
  if (p.startsWith("/")) return null;
  // Posix-normalize: collapse ./ and resolve internal .. segments
  const segments: string[] = [];
  for (const seg of p.split("/")) {
    if (seg === "" || seg === ".") continue;
    if (seg === "..") {
      if (segments.length === 0) return null; // escape attempt
      segments.pop();
      continue;
    }
    segments.push(seg);
  }
  if (segments.length === 0) return null;
  return `${rootDir.replace(/\/$/, "")}/${segments.join("/")}`;
}

/** Apply a single FileOp to the sandbox filesystem. Never throws —
 *  every error becomes status="failed" with a human-readable reason. */
export async function applyFileOp(
  fs: SandboxFileSystemLike,
  op: FileOp,
  rootDir: string
): Promise<FileApplyResult> {
  const safePath = sanitizePath(op.path, rootDir);
  if (!safePath) {
    return { path: op.path, status: "failed", reason: `path escape blocked: ${op.path}` };
  }

  const isJsx = op.path.endsWith(".tsx") || op.path.endsWith(".jsx");

  if (op.kind === "create") {
    if (op.newContent === undefined) {
      return { path: op.path, status: "failed", reason: "no newContent on create op" };
    }
    try {
      let contentToWrite = isJsx ? annotateAtlasIds(safePath, op.newContent) : op.newContent;
      if (isJsx) contentToWrite = ensureAtlasEditBridge(safePath, contentToWrite);
      await fs.write(safePath, contentToWrite);
      return { path: op.path, status: "written", bytesWritten: byteLen(contentToWrite) };
    } catch (err) {
      return { path: op.path, status: "failed", reason: (err as Error).message };
    }
  }

  if (op.kind === "modify") {
    if (!op._chunks || op._chunks.length === 0) {
      return { path: op.path, status: "skipped", reason: "no hunks attached to modify op" };
    }
    let existing: string;
    try {
      existing = await fs.read(safePath);
    } catch (err) {
      return { path: op.path, status: "skipped", reason: `read failed: ${(err as Error).message}` };
    }
    const reconstructed = reconstructFromChunks(existing, op._chunks);
    if (!reconstructed.ok) {
      return { path: op.path, status: "skipped", reason: reconstructed.reason };
    }
    try {
      let contentToWrite = isJsx ? annotateAtlasIds(safePath, reconstructed.content) : reconstructed.content;
      if (isJsx) contentToWrite = ensureAtlasEditBridge(safePath, contentToWrite);
      await fs.write(safePath, contentToWrite);
      return { path: op.path, status: "written", bytesWritten: byteLen(contentToWrite) };
    } catch (err) {
      return { path: op.path, status: "failed", reason: (err as Error).message };
    }
  }

  if (op.kind === "delete") {
    const present = await fs.exists(safePath);
    if (!present) {
      return { path: op.path, status: "skipped", reason: "already absent" };
    }
    try {
      await fs.remove(safePath);
      return { path: op.path, status: "written" };
    } catch (err) {
      return { path: op.path, status: "failed", reason: (err as Error).message };
    }
  }

  // Defensive: should be unreachable if FileOp.kind union stays at 3.
  return { path: op.path, status: "failed", reason: `unknown op kind: ${(op as { kind: string }).kind}` };
}

function byteLen(s: string): number {
  // Use Buffer for accurate UTF-8 byte length; fallback to char count.
  return typeof Buffer !== "undefined" ? Buffer.byteLength(s, "utf8") : s.length;
}

/**
 * Debug-only: dump the raw diff string to a temp file so D14 (multi-file
 * leak) can be reproduced from real LLM bytes. Gated on
 * `ATLAS_DEBUG_CAPTURE_DIFFS=true`; a no-op otherwise. Failures are
 * swallowed — capture must NEVER break the apply pipeline.
 *
 * Filename: `<os.tmpdir()>/atlas-diff-captures/<isoTimestamp>-<sha8>.diff`
 * sha8 is the first 8 hex chars of sha256(diff) so identical diffs
 * collide on disk (useful for debugging idempotency).
 */
function captureRawDiffForDebug(diff: string): void {
  if (process.env.ATLAS_DEBUG_CAPTURE_DIFFS !== "true") return;
  try {
    // Lazy require so bundlers that target the browser don't choke.
    const fs = require("node:fs") as typeof import("node:fs");
    const path = require("node:path") as typeof import("node:path");
    const os = require("node:os") as typeof import("node:os");
    const crypto = require("node:crypto") as typeof import("node:crypto");
    const dir = path.join(os.tmpdir(), "atlas-diff-captures");
    fs.mkdirSync(dir, { recursive: true });
    const sha = crypto.createHash("sha256").update(diff).digest("hex").slice(0, 8);
    const ts = new Date().toISOString().replace(/[:.]/g, "-");
    const file = path.join(dir, `${ts}-${sha}.diff`);
    fs.writeFileSync(file, diff, "utf8");
    // Stderr marker for grep correlation with server logs (ritualId /
    // projectId aren't in scope here; correlate by timestamp).
    process.stderr.write(`[ATLAS_DEBUG_CAPTURE_DIFFS] wrote ${file} (${diff.length} bytes)\n`);
  } catch {
    // Capture is best-effort. Swallow.
  }
}

export async function applyDiff(
  fs: SandboxFileSystemLike,
  diff: string,
  opts: { rootDir?: string } = {}
): Promise<ApplyDiffResult> {
  const rootDir = opts.rootDir ?? DEFAULT_ROOT;
  const { ops, error } = parseDiff(diff);

  if (error) {
    return { ok: false, parsed: 0, written: 0, failed: 0, skipped: 0, files: [], parseError: error };
  }
  if (ops.length === 0) {
    // Empty / whitespace / no-op diff. ok per contract — caller writes
    // nothing but doesn't see this as a failure.
    return { ok: true, parsed: 0, written: 0, failed: 0, skipped: 0, files: [] };
  }

  const files: FileApplyResult[] = [];
  for (const op of ops) {
    files.push(await applyFileOp(fs, op, rootDir));
  }

  const written = files.filter((f) => f.status === "written").length;
  const failed = files.filter((f) => f.status === "failed").length;
  const skipped = files.filter((f) => f.status === "skipped").length;

  return {
    ok: failed === 0,
    parsed: ops.length,
    written,
    failed,
    skipped,
    files
  };
}

import type { Chunk } from "parse-diff";

/** Apply parsed hunks to existing file content. Each hunk specifies
 *  `oldStart` / `oldLines` / a sequence of `add | del | normal` changes.
 *  We walk the original file line-by-line, splice in the hunks at the
 *  declared offsets, and fail loudly if a hunk's "context" lines don't
 *  match what's actually at that offset (no fuzzy matching — this is
 *  the MVP; Plan E will need leniency for multi-turn edits). */
function reconstructFromChunks(
  original: string,
  chunks: Chunk[]
): { ok: true; content: string } | { ok: false; reason: string } {
  // Preserve the original's trailing-newline state explicitly. split/join
  // happens to round-trip on pure no-op modifies, but a splice that
  // touches the last line of a no-trailing-newline file can drift —
  // detect-and-restore is the safe pattern.
  const hadTrailingNewline = original.endsWith("\n");
  const lines = original.split("\n");
  // If the input ended with \n, split produces a trailing empty string.
  // Pop it so the splice indices operate uniformly on real content lines;
  // we re-add the newline at the end via hadTrailingNewline.
  if (hadTrailingNewline && lines[lines.length - 1] === "") lines.pop();

  // parse-diff gives offsets in 1-based line numbers. We work in a
  // mutable copy and edit per-hunk; sort hunks by oldStart descending
  // so earlier indices remain valid as we splice.
  const sortedChunks = [...chunks].sort((a, b) => b.oldStart - a.oldStart);
  for (const chunk of sortedChunks) {
    const offset = chunk.oldStart - 1; // 0-based slice index
    const replaced: string[] = [];
    let cursor = 0; // walks the original "old" lines for this chunk
    for (const change of chunk.changes) {
      if (change.type === "normal") {
        const expected = change.content.slice(1); // strip leading " "
        const actual = lines[offset + cursor];
        if (actual !== expected) {
          return {
            ok: false,
            reason: `hunk mismatch at line ${offset + cursor + 1}: expected ${JSON.stringify(expected)}, got ${JSON.stringify(actual)}`
          };
        }
        replaced.push(expected);
        cursor++;
      } else if (change.type === "del") {
        const expected = change.content.slice(1); // strip leading "-"
        const actual = lines[offset + cursor];
        if (actual !== expected) {
          return {
            ok: false,
            reason: `hunk mismatch at line ${offset + cursor + 1}: expected to delete ${JSON.stringify(expected)}, got ${JSON.stringify(actual)}`
          };
        }
        cursor++;
        // Don't push — this line is removed in the new content
      } else {
        // type === "add"
        replaced.push(change.content.slice(1)); // strip leading "+"
        // Don't advance cursor — this is a brand-new line
      }
    }
    lines.splice(offset, cursor, ...replaced);
  }
  return { ok: true, content: lines.join("\n") + (hadTrailingNewline ? "\n" : "") };
}
