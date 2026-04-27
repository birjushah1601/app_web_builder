"use client";

import { useState } from "react";

export interface RoleEvent {
  eventType: string;
  payload: unknown;
}

export interface StartRitualResult {
  ritualId: string;
  artifact?: unknown;
  roleEvents: RoleEvent[];
  developerOutput?: { diff: string; summary?: string };
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
  }) => Promise<StartRitualResult>;
}

interface HistoryEntry {
  role: "user" | "architect";
  text?: string;
  result?: StartRitualResult;
}

export function ChatPanel({ projectId, action }: ChatPanelProps) {
  const [text, setText] = useState("");
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [history, setHistory] = useState<HistoryEntry[]>([]);

  async function send() {
    if (!text.trim() || pending) return;
    setPending(true);
    setError(null);
    setHistory((h) => [...h, { role: "user", text }]);
    try {
      const result = await action({ projectId, userTurn: text, editClass: "structural" });
      setHistory((h) => [...h, { role: "architect", result }]);
      setText("");
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
            <ArchitectOutput key={i} result={m.result!} />
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
        <textarea
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
function ArchitectOutput({ result }: { result: StartRitualResult }) {
  const blockingQuestions = result.roleEvents.filter(
    (e) => e.eventType === "architect.triage.needs_input"
  );
  const developerFailedEvent = result.roleEvents.find(
    (e) => e.eventType === "developer.dispatch.failed" || e.eventType === "developer.both_failed"
  );

  return (
    <>
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
        <DeveloperOutputCard output={result.developerOutput} />
      ) : developerFailedEvent ? (
        <div data-testid="developer-failed" className="mb-3 rounded-md border border-red-200 bg-red-50 p-2 text-xs text-red-800">
          <div className="mb-1 font-semibold">Developer step failed</div>
          <div className="break-words">
            {(developerFailedEvent.payload as { error?: string }).error ?? "Unknown error"}
          </div>
        </div>
      ) : null}
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

function DeveloperOutputCard({ output }: { output: { diff: string; summary?: string } }) {
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
      <p className="mt-2 text-[10px] italic text-indigo-600">
        Note: diff not yet applied to the live preview sandbox.
      </p>
    </div>
  );
}
