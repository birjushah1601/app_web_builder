# Plan C — Apply Developer Diff to Live Preview Sandbox — Design

> **Status:** Brainstormed 2026-04-27, awaiting user spec review before plan writing.
> **Pre-req shipped:** Plan B (architect → developer chain produces a unified diff in `RitualSnapshot.developerOutput.diff`) — see `docs/superpowers/plans/2026-04-27-plan-b-developer-chain.md`.

## Goal

After every successful developer dispatch, write the diff's file changes into the project's running E2B sandbox at `/code/src/`, so the preview iframe (Next.js dev server with HMR) auto-refreshes and the user sees the generated app live. Closes the user-visible loop "I described an app → I see it running."

## Non-goals (deferred to later plans)

- Multi-turn diff stacking (turn 2 assumes turn 1 applied) — Plan E
- Conflict resolution / three-way merge / dry-run preview before apply
- Rollback / undo of an applied diff (needs snapshot mechanism we don't have)
- Per-file approve/reject UI before apply (auto-apply for now)
- Forced iframe reload (relying on Next's auto-HMR; user can manually reload if it doesn't pick up)
- Applying to anything other than the project's main sandbox (no per-branch sandboxes, no preview-of-preview)

## Architecture

Plan C lives entirely inside `apps/atlas-web`. No new packages, no changes to `@atlas/sandbox-e2b`'s public API, no changes to the developer role.

```
RitualEngine.start()
  ├─ architect dispatch          (existing)
  ├─ developer dispatch          (existing — produces developer.diff)
  └─ NEW: applyDiff(sandbox, diff)
        ├─ parseDiff(diff)       → Array<FileOp>
        └─ applyFileOp(...)      → per-file write via sandbox.fs
        ↓
        SandboxApplyResult on snapshot
```

The engine's `start()` already takes a `Conductor`. Plan C adds an optional `sandboxApplier` dependency to `RitualEngineOptions` so the engine doesn't directly couple to atlas-web's sandbox factory — the engine package stays clean of E2B concerns. The injection happens in atlas-web's `lib/engine/factory.ts` where `getSandboxFactory()` is already wired.

## Components

### `apps/atlas-web/lib/sandbox/apply-diff.ts` (NEW)

Pure logic, no I/O at the file-content level — takes a `SandboxFileSystem` interface (read/write/list) so unit tests can pass an in-memory fake.

```ts
export interface FileOp {
  kind: "create" | "modify" | "delete";
  path: string;          // sanitized, relative to /code/
  newContent?: string;   // for create + modify
}

export interface FileApplyResult {
  path: string;
  status: "written" | "skipped" | "failed";
  reason?: string;
  bytesWritten?: number;
}

export interface ApplyDiffResult {
  ok: boolean;
  parsed: number;        // total file ops parsed from the diff
  written: number;
  failed: number;
  skipped: number;
  files: FileApplyResult[];
  parseError?: string;   // present iff diff didn't parse
}

export function parseDiff(diff: string): { ops: FileOp[]; error?: string };

export interface SandboxFileSystemLike {
  read(path: string): Promise<string>;       // throws if not found
  write(path: string, content: string): Promise<void>;
  exists(path: string): Promise<boolean>;
}

export async function applyDiff(
  fs: SandboxFileSystemLike,
  diff: string,
  opts?: { rootDir?: string }                // defaults to "/code"
): Promise<ApplyDiffResult>;
```

`parseDiff` uses the npm `parse-diff` package (~5 KB, MIT, ~6M weekly DLs). It yields per-file hunk arrays; we then reconstruct `newContent` either from scratch (create — `--- /dev/null`) or by reading the existing file and applying hunks (modify).

### `apps/atlas-web/lib/sandbox/sandbox-fs-adapter.ts` (NEW)

Thin adapter over `@atlas/sandbox-e2b`'s `E2BFileSystem` (or whatever the lifecycle exposes), conforming to `SandboxFileSystemLike`. Lives in atlas-web because the wiring is atlas-web-specific.

### `RitualEngineOptions.sandboxApplier?` (NEW, ritual-engine package)

```ts
export interface SandboxApplier {
  /** Returns the per-file result of applying the diff to the project's
   *  sandbox. Errors at the sandbox-acquisition layer (no provisioned
   *  sandbox, sandbox unreachable) are translated to ApplyDiffResult
   *  with ok=false rather than thrown. */
  apply(projectId: string, diff: string): Promise<ApplyDiffResult>;
}
```

Optional — when absent (existing tests, packages not wiring this), `start()` skips the apply step entirely. This preserves backward compatibility.

### `RitualSnapshot.sandboxApplyResult?` (NEW, ritual-engine)

```ts
sandboxApplyResult?: ApplyDiffResult;
```

Populated by `start()` when both:
- `developerOutput.diff` is non-empty
- `sandboxApplier` is configured

### `apps/atlas-web/lib/engine/factory.ts` (MODIFIED)

Wires the SandboxApplier:

```ts
return new RitualEngine({
  conductor,
  eventSink: ...,
  personaPreferences: ...,
  sandboxApplier: {
    apply: async (projectId, diff) => {
      try {
        const session = await getSandboxFactory().getOrProvision(projectId);
        const fs = createSandboxFsAdapter(session);
        return await applyDiff(fs, diff);
      } catch (err) {
        return { ok: false, parsed: 0, written: 0, failed: 0, skipped: 0,
                 files: [], parseError: `sandbox unavailable: ${(err as Error).message}` };
      }
    }
  }
});
```

### `apps/atlas-web/lib/actions/startRitual.ts` (MODIFIED)

`StartRitualResult` gains optional `sandboxApplyResult?: ApplyDiffResult`, populated from snapshot.

### `apps/atlas-web/components/ChatPanel.tsx` (MODIFIED)

`DeveloperOutputCard` adds a status line below the diff summary:

- `ok && failed === 0`: green "✓ Wrote N files to live preview — refresh the iframe if it doesn't update"
- `ok && failed > 0`: amber "⚠ Wrote N of M files; K failed (expand for details)" with per-file expandable list
- `!ok && parseError`: red "✗ Could not apply: \<parseError\>" with the diff still expandable below
- `sandboxApplyResult` absent: nothing rendered (sandbox apply was skipped — e.g. cosmetic edit)

## Data flow

```
1. ChatPanel.send("add login form")
2. Server Action startRitual → engine.start
3. Architect runs            → emits architect.pass2.completed { artifact }
4. Developer runs (chained)  → emits developer.completed; diff produced
5. Engine: if developerOutput.diff present and sandboxApplier configured:
   5a. sandboxApplier.apply(projectId, diff)
   5b. Inside: getOrProvision → sandbox session → fs adapter
   5c. parseDiff(diff) → FileOp[]
   5d. For each FileOp: read existing (if modify) → apply hunks → write
   5e. Returns ApplyDiffResult
6. Engine writes sandboxApplyResult into RitualRecord
7. emit ritual.artifact_emitted (existing) — no new event types; the snapshot field is the contract
8. Server Action returns StartRitualResult { ritualId, artifact, roleEvents,
                                              developerOutput, sandboxApplyResult }
9. ChatPanel renders the new status line; iframe HMR-refreshes within ~2s
```

## Failure modes

| Mode | Detection | Behavior |
|---|---|---|
| Diff doesn't parse | `parse-diff` throws or returns nothing | `ApplyDiffResult { ok: false, parseError: "..." }`; red panel; diff still visible |
| Sandbox not provisioned for project | `getOrProvision` throws | `ApplyDiffResult { ok: false, parseError: "sandbox unavailable: ..." }`; red panel |
| File modification's hunk doesn't match existing content | Reconstruction fails | `FileApplyResult { status: "skipped", reason: "hunk mismatch at line N" }`; other files still attempted |
| Path escapes `/code/` (e.g. `../etc/passwd`) | Sanitization in `applyFileOp` | `FileApplyResult { status: "failed", reason: "path escape blocked" }`; logged for audit |
| `sandbox.fs.write` fails (network, quota, etc.) | thrown by E2B SDK | `FileApplyResult { status: "failed", reason: error.message }`; other files still attempted |
| Developer produced empty diff | `parsed === 0` | `ApplyDiffResult { ok: true, parsed: 0, files: [] }`; ChatPanel shows nothing (sandbox apply was effectively a no-op) |
| `delete` op for a file that doesn't exist | `exists` check returns false | `FileApplyResult { status: "skipped", reason: "already absent" }` |
| Multiple file ops for the same path in one diff | `parseDiff` yields multiple ops | Last write wins; warning logged |

The contract: **applyDiff never throws.** Every failure becomes a structured `ApplyDiffResult` so the ritual + ChatPanel can always render a clear answer.

## Path sanitization

For each `op.path`:
1. Strip leading `a/` or `b/` prefix (git-diff convention).
2. Normalize via `path.posix.normalize()`.
3. Reject if it starts with `/`, contains `..` after normalization, or contains a null byte.
4. Prepend `rootDir` (default `/code`).
5. Result must still be under `rootDir` after `path.posix.resolve()`. Otherwise reject.

This is the only security-sensitive surface in plan C.

## Testing strategy

**Unit (apply-diff.test.ts) — covers all logic without touching E2B:**
- Parse: empty diff, single create, single modify, single delete, mixed, malformed JSON-not-diff, malformed truncated, multi-file
- Apply: create writes new content; modify reads + reconstructs + writes; delete removes; failures don't propagate; skipped paths preserve other ops
- Sanitization: `../etc/passwd` blocked; absolute path blocked; `a/path/file` becomes `path/file`; valid paths normalized
- Edge: empty file content, files with binary-looking content (we treat all as text per E2B SDK), 5MB diff (still parses)
- Uses an in-memory `Map<string, string>` as `SandboxFileSystemLike`

**Unit (sandbox-fs-adapter.test.ts):**
- Mocks the E2B sandbox session; verifies adapter calls `sandbox.files.read` / `.write` / `.exists` with correct paths
- Translates E2B errors into thrown plain Errors that `applyDiff` can categorize

**Integration (engine-developer-chain.test.ts — extend):**
- Add case: with `sandboxApplier` configured, `start()` calls it after developer succeeds, captures result into snapshot
- Add case: with `sandboxApplier` configured, but developer produces no diff, applier is NOT called
- Add case: applier returns `{ ok: false, parseError: "..." }` — ritual still completes, snapshot has the failure record

**Component (ChatPanel.test.tsx — extend, ~3 cases):**
- Renders green "✓ Wrote N files" panel when `sandboxApplyResult.ok && failed === 0`
- Renders amber mixed-result panel with per-file list when some failed
- Renders red parse-error panel when `!ok && parseError`

**Factory (factory.test.ts — extend, 1 case):**
- Verifies `sandboxApplier` is wired when the engine is constructed via `getRitualEngine`

## Acceptance criteria

The user clicks Send with a structural-edit prompt. After ~50s wall time:

1. Architect plan card renders (existing behavior preserved)
2. Developer diff card renders (existing behavior preserved)
3. **NEW**: Sandbox-apply status line appears in the developer card: green "✓ Wrote N files to live preview" within ~2 seconds of the developer card appearing
4. **NEW**: The preview iframe in the canvas refreshes automatically within HMR's typical 1–3s window, showing the new code's output
5. If sandbox is unreachable, the apply status line shows red with a clear reason; the rest of the page is unaffected (no 500, no opaque error)

Test signal:
- All new unit tests pass: ~15 for apply-diff, ~3 for sandbox-fs-adapter
- All new component tests pass: ~3 ChatPanel cases
- All existing tests still pass: chain test (7), provider tests (25), full atlas-web suite (198)
- Workspace typecheck clean

## What's intentionally simple

- **Hunks are applied positionally**, no fuzzy matching. If the diff says "change line 5 from `x` to `y`" and line 5 isn't `x`, the hunk fails for that file. This is fine for the MVP because the developer always generates against the sandbox's current state (single-turn — Plan E will need fuzzy matching).
- **Binary files are NOT supported.** `parse-diff` handles binary patches as opaque blocks; we treat them as "skipped: binary diffs not supported." Acceptable — the developer's prompts focus on text source.
- **No throttling / queuing** if multiple Send requests fire concurrently for the same project. The sandbox factory already coalesces concurrent provision calls; concurrent writes to the same file would be a race we don't address here. Plan E (multi-turn) will need to.

## Out of scope (would expand the work meaningfully)

- A "Reload preview" button if HMR doesn't auto-refresh. Easy to add later if needed.
- An "undo last apply" UI. Needs snapshot before/after.
- A "review diff before apply" gate. Wholesale auto-apply for now.
- Telemetry/observability for diff sizes and apply latencies. Stub via console.error like the rest.
- Streaming the apply progress ("writing src/login.tsx..."). Plan D scope.

## Open questions (resolved during brainstorming, recorded for posterity)

1. **Apply via parse-diff in JS vs git apply in sandbox?** Resolved: parse-diff in JS (no template change, easier failure surface).
2. **Modify vs. emit-full-files schema?** Resolved: keep diff schema (smaller blast radius; preserves existing developer tests + prompts).
3. **Fail-fast on first error vs. best-effort across all files?** Resolved: best-effort. Show per-file results; user gets partial value even when one file fails.
4. **Trigger HMR or rely on Next's watcher?** Resolved: rely on Next's watcher — already configured in our `atlas-next-ts` template via `pnpm dev`.
