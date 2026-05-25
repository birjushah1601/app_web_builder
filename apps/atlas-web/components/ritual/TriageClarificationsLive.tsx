"use client";
/**
 * TriageClarificationsLive — Plan U slice 3b.
 *
 * Sticky banner that mounts above the canvas when the engine has paused
 * a ritual awaiting triage clarifications. Subscribes to the project's
 * live SSE stream via useTriageClarifications. On submit, resolves the
 * engine pause via the submitClarificationAnswers Server Action; the
 * engine's _runRitual then re-dispatches architect with the answers
 * folded into userTurn and the rest of the pipeline proceeds.
 *
 * Mounted near the top of the canvas page (outside CanvasShellWired so
 * it surfaces regardless of whether the canvas-flow flag is on).
 */
import * as React from "react";
import { TriageClarificationForm } from "./TriageClarificationForm";
import { useTriageClarifications } from "@/lib/canvas/useTriageClarifications";
import { submitClarificationAnswers } from "@/lib/actions/submitClarificationAnswers";

export function TriageClarificationsLive() {
  const pending = useTriageClarifications();
  const [submitting, setSubmitting] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);

  if (!pending) return null;

  async function handleSubmit(answers: Record<string, string>) {
    if (!pending) return;
    setSubmitting(true);
    setError(null);
    try {
      await submitClarificationAnswers({ ritualId: pending.ritualId, answers });
      // The form dismisses itself once the engine emits
      // `ritual.triage.clarification_resolved` on the SSE stream and the
      // hook returns null. No optimistic local hide — the SSE event is the
      // source of truth.
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      setError(msg || "Failed to submit clarification answers.");
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <div
      data-testid="triage-clarifications-live"
      className="mb-3 rounded-md border border-amber-300 bg-amber-50 p-3"
    >
      <div className="mb-2 text-xs font-semibold text-amber-900">
        Architect paused — needs your input to continue
      </div>
      {error && (
        <div role="alert" className="mb-2 rounded border border-red-200 bg-red-50 px-2 py-1 text-xs text-red-700">
          {error}
        </div>
      )}
      <TriageClarificationForm
        questions={pending.questions.map((q) => ({
          question: q.question,
          ...(q.reason !== undefined ? { reason: q.reason } : {}),
          ...(q.widgetKind !== undefined ? { widgetKind: q.widgetKind } : {}),
          ...(q.options !== undefined ? { options: q.options } : {})
        }))}
        onSubmitStructured={handleSubmit}
        pending={submitting}
      />
    </div>
  );
}
