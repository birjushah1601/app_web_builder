import type { Chunk } from "parse-diff";

/** A single file-level operation extracted from a unified diff. */
export interface FileOp {
  kind: "create" | "modify" | "delete";
  /** Sandbox-relative path, sanitized — no leading `/`, no `..`,
   *  always relative to the apply rootDir (default `/code`). */
  path: string;
  /** For "create" and "modify": the full new content of the file.
   *  For "delete": absent. */
  newContent?: string;
  /** Internal — hunks needed for modify reconstruction. Populated by
   *  parseDiff for kind="modify"; ignored for create/delete. */
  _chunks?: Chunk[];
}

/** Outcome of applying one FileOp to the sandbox. */
export interface FileApplyResult {
  path: string;
  status: "written" | "skipped" | "failed";
  /** Human-readable reason for non-"written" statuses. */
  reason?: string;
  /** Set when status === "written"; bytes written via fs.write. */
  bytesWritten?: number;
}

/** Aggregate outcome of applying a full diff. Never thrown — callers
 *  always receive this structure even when nothing was applied. */
export interface ApplyDiffResult {
  /** True iff parsed > 0 AND failed === 0. False on parse error or any
   *  per-file failure. Skipped files do NOT flip ok to false. */
  ok: boolean;
  /** Number of file ops the diff parsed into. 0 means parse failed
   *  OR the diff was empty/whitespace-only. */
  parsed: number;
  written: number;
  failed: number;
  skipped: number;
  files: FileApplyResult[];
  /** Present iff parsed === 0 due to a parse error. */
  parseError?: string;
}

/** Minimal filesystem surface applyDiff needs. The concrete
 *  implementation in sandbox-fs-adapter.ts wraps E2B's SDK; tests use
 *  an in-memory Map<string, string>. */
export interface SandboxFileSystemLike {
  /** Reads a file's content as UTF-8 string. Throws if not found. */
  read(path: string): Promise<string>;
  /** Writes content (creates parent dirs as needed). Throws on I/O failure. */
  write(path: string, content: string): Promise<void>;
  /** Returns true iff the path exists (file or directory). Never throws. */
  exists(path: string): Promise<boolean>;
  /** Removes a file. No-op if absent. Throws on I/O error other than ENOENT. */
  remove(path: string): Promise<void>;
}
