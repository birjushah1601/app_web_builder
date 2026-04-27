import parseDiffLib from "parse-diff";
import type { FileOp, FileApplyResult, SandboxFileSystemLike } from "./apply-diff-types";

/** Parses a unified diff into per-file operations. Wraps the parse-diff
 *  npm library with our internal FileOp shape (which sanitizes paths
 *  and normalizes the create/modify/delete kind classification). */
export function parseDiff(diff: string): { ops: FileOp[]; error?: string } {
  if (!diff || !diff.trim()) {
    return { ops: [] };
  }

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
      // modify: newContent is reconstructed in applyFileOp using the
      // existing file's content + the parsed hunks
      ops.push({ kind, path });
    }
  }

  return { ops };
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

  if (op.kind === "create") {
    if (op.newContent === undefined) {
      return { path: op.path, status: "failed", reason: "no newContent on create op" };
    }
    try {
      await fs.write(safePath, op.newContent);
      return { path: op.path, status: "written", bytesWritten: byteLen(op.newContent) };
    } catch (err) {
      return { path: op.path, status: "failed", reason: (err as Error).message };
    }
  }

  // modify and delete branches added in subsequent tasks
  return { path: op.path, status: "skipped", reason: `kind not yet supported: ${op.kind}` };
}

function byteLen(s: string): number {
  // Use Buffer for accurate UTF-8 byte length; fallback to char count.
  return typeof Buffer !== "undefined" ? Buffer.byteLength(s, "utf8") : s.length;
}
