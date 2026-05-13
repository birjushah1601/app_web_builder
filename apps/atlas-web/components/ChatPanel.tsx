"use client";

import { useState } from "react";
import { SecurityReportPanel, type SecurityReport } from "@/components/SecurityReportPanel";
import { AccessibilityReportPanel, type AccessibilityReport } from "@/components/AccessibilityReportPanel";
import { RefinementInputBar } from "@/components/RefinementInputBar";
import { ReferenceDropZone, type ReferenceImage } from "@/components/prompt/ReferenceDropZone";
import { SelectionChip } from "@/components/canvas/SelectionChip";

export interface RoleEvent {
  eventType: string;
  payload: unknown;
}

export interface StartRitualResult {
  ritualId: string;
  artifact?: unknown;
  roleEvents: RoleEvent[];
  /** Plan I: present when SecurityRole ran in the post-developer chain. */
  securityReport?: SecurityReport;
  /** Plan I: present when AccessibilityRole ran. */
  accessibilityReport?: AccessibilityReport;
  /** Plan L: > 0 when this ritual was created by the engine's auto-fix
   *  loop after a parent ritual's gate failed. ChatPanel renders an
   *  "(auto-fix #N)" badge. */
  fixAttempts?: number;
  developerOutput?: { diff: string; summary?: string };
  sandboxApplyResult?: {
    ok: boolean;
    parsed: number;
    written: number;
    failed: number;
    skipped: number;
    files: Array<{
      path: string;
      status: "written" | "skipped" | "failed";
      reason?: string;
      bytesWritten?: number;
    }>;
    parseError?: string;
  };
}

export interface ChatPanelProps {
  projectId: string;
  /**
   * Server Action reference — must be the raw action export, not an inline
   * closure. React 19 serializes server actions across the RSC boundary but
   * refuses to serialize user-defined closures.
   */
  action: (input: {
    projectId: string;
    userTurn: string;
    editClass: "structural" | "cosmetic";
    /** Plan UXO Task 6 — when reference-input is on, ChatPanel forwards the
     *  user's drag/dropped screenshots so they flow into startRitual's
     *  referenceImages field. Omitted when reference-input is off or no
     *  references were dropped (exactOptionalPropertyTypes: omit ≠ undefined). */
    referenceImages?: ReadonlyArray<{ url: string; caption?: string }>;
  }) => Promise<StartRitualResult>;
  /** Plan UXO Task 6 — when ATLAS_FF_REFERENCE_INPUT is on (read server-side),
   *  render the ReferenceDropZone above the textarea. */
  referenceInputEnabled?: boolean;
  /** Plan K: when ATLAS_FF_MULTI_TURN is on (read server-side), render
   *  the <RefinementInputBar /> beneath each developer-output card so the
   *  user can iterate on the prior result. */
  multiTurnFlagEnabled?: boolean;
  /** Plan K: server action that creates a child ritual linked to the
   *  given parentRitualId. Required when multiTurnFlagEnabled is true. */
  refineAction?: (input: {
    projectId: string;
    parentRitualId: string;
    userTurn: string;
  }) => Promise<StartRitualResult & { parentRitualId: string }>;
  /**
   * Refine-by-default: when set, the main input box auto-routes the next
   * submit through `refineAction` (parentRitualId = this id) instead of the
   * cold-start `action`. Server-side wiring resolves this from the most
   * recent ritual.started event for the project, so a chat returning from
   * a fresh page load picks up where it left off.
   *
   * Routing rules (in order):
   *   1. multiTurnFlagEnabled === false → always cold-start (today's behavior).
   *   2. refineAction not provided      → always cold-start.
   *   3. latest ritual id known (this prop OR result of a previous send)
   *      → refine on that id.
   *   4. otherwise                       → cold-start.
   *
   * After a successful submit the component remembers the new ritualId
   * locally so subsequent submits within the same session continue the
   * thread without another DB round-trip.
   */
  initialLatestRitualId?: string;
  /** Plan canvas-in-place-editing Task 21 — when set, renders a SelectionChip
   *  above the textarea and routes submit through editElementAction. */
  selectionChip?: { label: string; atlasId: string; filePath: string };
  onClearSelection?: () => void;
  editElementAction?: (input: { projectId: string; filePath: string; atlasId: string; instruction: string }) => Promise<{ ok: boolean; error?: string }>;
}

interface HistoryEntry {
  role: "user" | "architect";
  text?: string;
  result?: StartRitualResult;
}

export function ChatPanel({
  projectId,
  action,
  multiTurnFlagEnabled = false,
  refineAction,
  initialLatestRitualId,
  referenceInputEnabled = false,
  selectionChip,
  onClearSelection,
  editElementAction
}: ChatPanelProps) {
  const [text, setText] = useState("");
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [history, setHistory] = useState<HistoryEntry[]>([]);
  // Plan UXO Task 6 — accumulate ReferenceDropZone results. Cleared after
  // a successful submit alongside the textarea (same "fresh prompt" semantics).
  const [references, setReferences] = useState<ReadonlyArray<ReferenceImage>>([]);
  // Refine-by-default state: starts at server-supplied initialLatestRitualId
  // (so chats survive a page refresh) and rolls forward on each successful
  // submit so subsequent sends in the same session continue the thread.
  // null = no parent ritual known → cold-start path.
  const [latestRitualId, setLatestRitualId] = useState<string | null>(
    initialLatestRitualId ?? null
  );

  /** Pure helper — exported for unit testing the routing decision. Returns
   *  true iff the next submit should call refineAction with parentRitualId. */
  function shouldRefine(): boolean {
    return Boolean(multiTurnFlagEnabled && refineAction && latestRitualId);
  }

  async function send() {
    if (!text.trim() || pending) return;
    setPending(true);
    setError(null);
    setHistory((h) => [...h, { role: "user", text }]);
    const capturedText = text;
    // Plan canvas-in-place-editing Task 21: when a selection chip is active,
    // route through editElementAction instead of the full ritual pipeline.
    if (selectionChip && editElementAction) {
      try {
        const result = await editElementAction({
          projectId,
          filePath: selectionChip.filePath,
          atlasId: selectionChip.atlasId,
          instruction: capturedText
        });
        if (result.ok) {
          setText("");
        } else {
          setError(result.error ?? "Edit failed. Please try again.");
        }
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        setError(msg || "Something went wrong. Please try again.");
      } finally {
        setPending(false);
      }
      return;
    }
    try {
      let result: StartRitualResult;
      if (shouldRefine() && refineAction && latestRitualId) {
        // Refine path — invisible to the user (same input box, same submit).
        // The result still flows through history as an architect entry, so
        // the rendering pipeline downstream is identical.
        result = await refineAction({
          projectId,
          parentRitualId: latestRitualId,
          userTurn: text
        });
      } else {
        // Plan UXO Task 6 — only include referenceImages on the call when
        // we have at least one. Empty arrays are omitted to keep the action
        // call shape backwards-compatible with existing tests + flag-OFF.
        result = await action({
          projectId,
          userTurn: text,
          editClass: "structural",
          ...(references.length > 0 ? { referenceImages: references } : {})
        });
      }
      setHistory((h) => [...h, { role: "architect", result }]);
      // Roll the parent forward so the next send refines on this turn.
      setLatestRitualId(result.ritualId);
      setText("");
      setReferences([]);
    } catch (err) {
      // Surface the failure so users don't experience a silent "the button did nothing"
      // crash. The message is intentionally short — full stacks belong in server logs.
      const msg = err instanceof Error ? err.message : String(err);
      setError(msg || "Something went wrong. Please try again.");
    } finally {
      setPending(false);
    }
  }

  return (
    <aside className="flex h-full w-80 flex-col border-l border-slate-200">
      <div className="flex-1 overflow-y-auto p-3">
        {history.map((m, i) => (
          m.role === "user" ? (
            <div key={i} className="mb-2 text-sm"><strong>You:</strong> {m.text}</div>
          ) : (
            <ArchitectOutput
              key={i}
              result={m.result!}
              projectId={projectId}
              multiTurnFlagEnabled={multiTurnFlagEnabled}
              onRefine={refineAction ? async (userTurn: string) => {
                const child = await refineAction({
                  projectId,
                  parentRitualId: m.result!.ritualId,
                  userTurn
                });
                setHistory((h) => [...h, { role: "user", text: userTurn }, { role: "architect", result: child }]);
              } : undefined}
            />
          )
        ))}
      </div>
      <form
        onSubmit={(e) => { e.preventDefault(); send(); }}
        className="border-t border-slate-200 p-2"
      >
        {error && (
          <div role="alert" className="mb-2 rounded-md border border-red-200 bg-red-50 px-2 py-1 text-xs text-red-700">
            {error}
          </div>
        )}
        {selectionChip !== undefined && (
          <div className="mb-1">
            <SelectionChip
              label={selectionChip.label}
              onRemove={onClearSelection ?? (() => {})}
            />
          </div>
        )}
        {referenceInputEnabled && (
          <div className="mb-2">
            <ReferenceDropZone
              onAdd={(ref) => setReferences((cur) => [...cur, ref])}
            />
          </div>
        )}
        <textarea
          data-prompt-input
          value={text}
          onChange={(e) => setText(e.target.value)}
          placeholder="Describe your change…"
          className="block w-full resize-none rounded-md border border-slate-300 p-2 text-sm"
          rows={3}
          disabled={pending}
        />
        <button type="submit" disabled={pending || !text.trim()} className="mt-2 rounded-md bg-slate-900 px-3 py-1 text-sm text-white disabled:opacity-50">Send</button>
      </form>
    </aside>
  );
}

/** Renders the architect's output for one ritual, plus the developer's output
 *  if the ritual chained into the developer role. Three architect cases:
 *   1. Triage blocked (architect.triage.needs_input events present) → show questions
 *   2. Pass2 completed (artifact present) → show scope + plan summary
 *   3. Neither (rare; role threw mid-pass1) → show "no output" diagnostic
 *  Plus a fourth panel below for developer output / failure when present.
 */
function ArchitectOutput({
  result,
  projectId,
  multiTurnFlagEnabled,
  onRefine
}: {
  result: StartRitualResult;
  projectId: string;
  multiTurnFlagEnabled?: boolean;
  onRefine?: (userTurn: string) => Promise<void>;
}) {
  const blockingQuestions = result.roleEvents.filter(
    (e) => e.eventType === "architect.triage.needs_input"
  );
  const developerFailedEvent = result.roleEvents.find(
    (e) => e.eventType === "developer.dispatch.failed" || e.eventType === "developer.both_failed"
  );

  return (
    <>
      {/* Plan L: badge fix-attempt rituals so users can tell at a glance which
       *  cards in the conversation thread came from the engine's auto-fix loop
       *  vs. the original user submission or a manual refinement. */}
      {result.fixAttempts !== undefined && result.fixAttempts > 0 && (
        <div className="mb-1">
          <span data-testid="auto-fix-badge" className="text-xs font-mono text-amber-700">
            (auto-fix #{result.fixAttempts})
          </span>
        </div>
      )}
      {blockingQuestions.length > 0 ? (
        <div data-testid="architect-needs-input" className="mb-3 rounded-md border border-amber-200 bg-amber-50 p-2 text-xs">
          <div className="mb-1 font-semibold text-amber-900">Architect needs more info:</div>
          <ul className="list-disc space-y-1 pl-4 text-amber-900">
            {blockingQuestions.map((q, i) => {
              const p = q.payload as { question?: string; reason?: string };
              return (
                <li key={i}>
                  <span className="font-medium">{p.question}</span>
                  {p.reason ? <span className="text-amber-700"> — {p.reason}</span> : null}
                </li>
              );
            })}
          </ul>
        </div>
      ) : result.artifact ? (
        <ArchitectPlanCard artifact={result.artifact} />
      ) : (
        <div data-testid="architect-no-output" className="mb-3 rounded-md border border-slate-200 bg-slate-50 p-2 text-xs text-slate-600">
          Architect ran but produced no plan or questions.
        </div>
      )}

      {result.developerOutput ? (
        <DeveloperOutputCard
          output={result.developerOutput}
          applyResult={result.sandboxApplyResult}
        />
      ) : developerFailedEvent ? (
        <div data-testid="developer-failed" className="mb-3 rounded-md border border-red-200 bg-red-50 p-2 text-xs text-red-800">
          <div className="mb-1 font-semibold">Developer step failed</div>
          <div className="break-words">
            {(developerFailedEvent.payload as { error?: string }).error ?? "Unknown error"}
          </div>
        </div>
      ) : null}

      {result.securityReport && <SecurityReportPanel report={result.securityReport} />}
      {result.accessibilityReport && <AccessibilityReportPanel report={result.accessibilityReport} />}

      {/* Plan K: render the refinement input bar under each ritual's developer
       *  output so the user can iterate. flagEnabled gates visibility; onRefine
       *  is undefined when ChatPanel wasn't passed a refineAction. */}
      {result.developerOutput && onRefine && (
        <RefinementInputBar
          projectId={projectId}
          parentRitualId={result.ritualId}
          flagEnabled={multiTurnFlagEnabled ?? false}
          onRefine={onRefine}
        />
      )}
    </>
  );
}

function ArchitectPlanCard({ artifact }: { artifact: unknown }) {
  const a = artifact as {
    scope?: string;
    plan?: { steps?: Array<{ title?: string; description?: string }> };
    summary?: string;
  };
  return (
    <div data-testid="architect-plan" className="mb-3 rounded-md border border-emerald-200 bg-emerald-50 p-2 text-xs">
      <div className="mb-1 font-semibold text-emerald-900">
        Architect plan{a.scope ? ` (${a.scope})` : ""}
      </div>
      {a.summary ? <p className="mb-2 text-emerald-900">{a.summary}</p> : null}
      {a.plan?.steps && a.plan.steps.length > 0 ? (
        <ol className="list-decimal space-y-1 pl-4 text-emerald-900">
          {a.plan.steps.map((s, i) => (
            <li key={i}>
              <span className="font-medium">{s.title ?? "(untitled)"}</span>
              {s.description ? <span className="text-emerald-700"> — {s.description}</span> : null}
            </li>
          ))}
        </ol>
      ) : (
        // No structured plan steps — show raw JSON so something is visible
        <details>
          <summary className="cursor-pointer text-emerald-900">Raw plan</summary>
          <pre className="mt-1 overflow-x-auto whitespace-pre-wrap break-all text-[10px] text-emerald-900">
            {JSON.stringify(a, null, 2)}
          </pre>
        </details>
      )}
    </div>
  );
}

function DeveloperOutputCard({
  output,
  applyResult
}: {
  output: { diff: string; summary?: string };
  applyResult?: StartRitualResult["sandboxApplyResult"];
}) {
  // Heuristic: count "diff --git" headers as files changed in the patch.
  // Falls back to "lines changed" when the patch isn't in git format.
  const fileMatches = output.diff.match(/^diff --git /gm);
  const filesChanged = fileMatches?.length ?? 0;
  const linesChanged = output.diff.split("\n").filter((l) => l.startsWith("+") || l.startsWith("-")).length;

  return (
    <div data-testid="developer-output" className="mb-3 rounded-md border border-indigo-200 bg-indigo-50 p-2 text-xs">
      <div className="mb-1 font-semibold text-indigo-900">Developer wrote code</div>
      {output.summary ? <p className="mb-2 text-indigo-900">{output.summary}</p> : null}
      <div className="mb-2 text-indigo-700">
        {filesChanged > 0 ? `${filesChanged} file${filesChanged === 1 ? "" : "s"} changed` : `${linesChanged} lines changed`}
      </div>
      <details>
        <summary className="cursor-pointer text-indigo-900">View diff</summary>
        <pre className="mt-1 max-h-96 overflow-auto whitespace-pre-wrap break-all rounded border border-indigo-100 bg-white p-2 text-[10px] text-slate-800">
          {output.diff}
        </pre>
      </details>
      {applyResult ? <SandboxApplyStatus result={applyResult} /> : (
        <p className="mt-2 text-[10px] italic text-indigo-600">
          Note: diff not yet applied to the live preview sandbox.
        </p>
      )}
    </div>
  );
}

/** Plan C status panel: shows the per-file outcome of writing the developer's
 *  diff into the project's E2B sandbox. Three variants:
 *   - Red:    parseError set → entire diff couldn't be parsed/applied
 *   - Green:  ok && failed===0 && skipped===0 → all files written
 *   - Amber:  partial success → list non-written entries with reason
 */
function SandboxApplyStatus({ result }: { result: NonNullable<StartRitualResult["sandboxApplyResult"]> }) {
  if (result.parseError) {
    return (
      <div data-testid="sandbox-apply-status" className="mt-2 rounded-md border border-red-200 bg-red-50 p-2 text-xs text-red-800">
        <strong className="block">Could not apply to live preview</strong>
        <span className="block break-words">{result.parseError}</span>
      </div>
    );
  }
  if (result.ok && result.failed === 0 && result.skipped === 0) {
    return (
      <div data-testid="sandbox-apply-status" className="mt-2 rounded-md border border-emerald-200 bg-emerald-50 p-2 text-xs text-emerald-800">
        ✓ Wrote {result.written} file{result.written === 1 ? "" : "s"} to live preview — refresh the iframe if it doesn't update automatically.
      </div>
    );
  }
  return (
    <div data-testid="sandbox-apply-status" className="mt-2 rounded-md border border-amber-200 bg-amber-50 p-2 text-xs text-amber-800">
      <strong className="block">
        Wrote {result.written} of {result.parsed} files
        {result.skipped > 0 ? `; skipped ${result.skipped}` : ""}
        {result.failed > 0 ? `; failed ${result.failed}` : ""}
      </strong>
      <ul className="mt-1 list-disc space-y-0.5 pl-4">
        {result.files
          .filter((f) => f.status !== "written")
          .map((f, i) => (
            <li key={i}>
              <code>{f.path}</code> — {f.status}
              {f.reason ? `: ${f.reason}` : ""}
            </li>
          ))}
      </ul>
    </div>
  );
}
