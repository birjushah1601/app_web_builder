"use client";
import * as React from "react";

/**
 * Plan U — structured triage clarifications.
 *
 * Renders the architect's blocker questions (`architect.triage.needs_input`
 * events) as an inline form instead of a flat bullet list. For each question
 * the form infers a widget kind from the question text:
 *
 *   - "X or Y or Z?"   → single-select radio group
 *   - "Should ..." / "Will ..." / "Do you ..." → yes/no radio pair
 *   - everything else  → small free-text input
 *
 * On submit the form serializes the answers into a multi-line English block
 * and calls `onSubmit(formatted)`. The caller wires `onSubmit` to the same
 * action/refineAction pipeline ChatPanel already uses — no engine change.
 *
 * Flag-OFF (`structured-triage` flag false) → the form never renders;
 * ChatPanel falls back to its existing bullet-list rendering.
 */

export interface TriageQuestionInput {
  /** The question text as emitted by the architect's triage step. */
  question: string;
  /** Optional human-readable rationale ("…because we don't know the framework"). */
  reason?: string;
  /** Plan U (full): optional widget kind declared by the architect's
   *  triage LLM. When set, the form uses this kind directly instead of
   *  the heuristic inference. When absent, falls back to classifyQuestion. */
  widgetKind?: "yes-no" | "single-select" | "text";
  /** Plan U (full): required when widgetKind === "single-select". A
   *  list of 2-6 short option labels. Ignored for other kinds. */
  options?: ReadonlyArray<string>;
}

export interface TriageClarificationFormProps {
  questions: ReadonlyArray<TriageQuestionInput>;
  /** Called with the formatted multi-line summary the user submitted. */
  onSubmit: (formatted: string) => void | Promise<void>;
  /** When true, the submit button shows a busy state. Caller-controlled so the
   *  same flag that disables the textarea also disables this form. */
  pending?: boolean;
}

type WidgetKind = "yes-no" | "single-select" | "text";

interface ResolvedQuestion {
  question: string;
  reason?: string;
  kind: WidgetKind;
  options?: ReadonlyArray<string>;
}

/** Pure: classifies one question's widget kind from its text alone.
 *  Exported for unit testing the heuristics in isolation. */
export function classifyQuestion(question: string): { kind: WidgetKind; options?: string[] } {
  const trimmed = question.trim();
  const lower = trimmed.toLowerCase();

  // Heuristic 1 — "X or Y" (or "X or Y or Z") with at least two operands
  // generally indicates a single-select. We extract operands by splitting on
  // " or " AFTER stripping a leading interrogative ("Which", "Should we",
  // etc.) so we don't capture the question word. Require the question to
  // actually contain a "?" so casual prose ("Mobile or desktop is fine")
  // doesn't become a radio.
  if (trimmed.endsWith("?") && / or /i.test(trimmed)) {
    const stem = trimmed.replace(/\?$/, "");
    // Split on " or " (case-insensitive) without the regex global flag — the
    // `or` should be a separator only, so a simple split is enough.
    const parts = stem.split(/ or /i).map((p) => p.trim());
    // Trim a leading "which", "should we", "do you want", etc. from the FIRST
    // chunk so the first option doesn't include the verb phrase.
    const cleanedFirst = parts[0]!
      .replace(/^(which|should we|should the|do you want to|do you want|will you|would you|will the|should i|do we)\s+/i, "")
      .trim();
    parts[0] = cleanedFirst;
    const options = parts.filter((p) => p.length > 0 && p.length < 80);
    // Conservative guard: if any option still contains a colon or "..." the
    // question is most likely open-ended ("Which framework: pick any") and
    // listing a 2-option radio would mislead the user. Fall through to text.
    const hasOpenEndedMarker = options.some((o) => o.includes(":") || o.includes("..."));
    if (options.length >= 2 && options.length <= 6 && !hasOpenEndedMarker) {
      return { kind: "single-select", options };
    }
  }

  // Heuristic 2 — interrogatives that imply a binary answer. Only fire when
  // the question is short-ish (< 140 chars) so a question like
  // "Should we, given the constraints from the brief, ..." still falls
  // through to free text.
  if (trimmed.endsWith("?") && trimmed.length < 140) {
    const binaryPrefixes = [
      "should we",
      "should the",
      "do you want",
      "do we",
      "will you",
      "would you",
      "is this",
      "are you"
    ];
    if (binaryPrefixes.some((p) => lower.startsWith(p))) {
      return { kind: "yes-no" };
    }
  }

  return { kind: "text" };
}

/** Pure: turns the user's answers into an English multi-line block suitable
 *  to drop into the next userTurn. Format mirrors what users would naturally
 *  type if they were free-texting the answers themselves — so the architect's
 *  next pass doesn't need a special parsing path. */
export function formatAnswers(
  questions: ReadonlyArray<ResolvedQuestion>,
  answers: ReadonlyArray<string>
): string {
  // Defensive: pad answers to match the question count so an undersize map
  // (shouldn't happen, but might during refactor) produces a coherent string
  // rather than throwing.
  const padded = questions.map((_, i) => answers[i] ?? "");
  return questions
    .map((q, i) => `- ${q.question} → ${padded[i]!.trim() || "(no answer)"}`)
    .join("\n");
}

function resolveQuestion(q: TriageQuestionInput): ResolvedQuestion {
  // Plan U (full): prefer the architect's declared widget kind when present.
  // Falls back to the original heuristic inference when the kind is absent
  // (backward compat with pre-Plan-U-full triage outputs).
  if (q.widgetKind !== undefined) {
    return {
      question: q.question,
      ...(q.reason !== undefined ? { reason: q.reason } : {}),
      kind: q.widgetKind,
      ...(q.widgetKind === "single-select" && q.options !== undefined
        ? { options: q.options }
        : {})
    };
  }
  const { kind, options } = classifyQuestion(q.question);
  return {
    question: q.question,
    ...(q.reason !== undefined ? { reason: q.reason } : {}),
    kind,
    ...(options !== undefined ? { options } : {})
  };
}

export function TriageClarificationForm({
  questions,
  onSubmit,
  pending = false
}: TriageClarificationFormProps) {
  const resolved = React.useMemo(() => questions.map(resolveQuestion), [questions]);
  const [answers, setAnswers] = React.useState<string[]>(() => resolved.map(() => ""));

  // Keep the answers array in sync if the question list reshapes between
  // renders (e.g., a new triage event arrives). Resets all answers — the
  // alternative (preserving by index) is misleading when question order
  // changes.
  React.useEffect(() => {
    setAnswers(resolved.map(() => ""));
  }, [resolved]);

  function updateAnswer(idx: number, value: string) {
    setAnswers((prev) => {
      const next = prev.slice();
      next[idx] = value;
      return next;
    });
  }

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (pending) return;
    const formatted = formatAnswers(resolved, answers);
    void onSubmit(formatted);
  }

  // Every required-ish question (every question, in this v1) must have an
  // answer to enable submit. Single-select / yes-no answers are non-empty
  // once clicked; text inputs require trimmed non-empty.
  const allAnswered = answers.every((a) => a.trim().length > 0);

  return (
    <form
      data-testid="triage-clarification-form"
      onSubmit={handleSubmit}
      className="mb-3 rounded-md border border-amber-200 bg-amber-50 p-2 text-xs"
    >
      <div className="mb-2 font-semibold text-amber-900">Architect needs more info:</div>
      <div className="space-y-3">
        {resolved.map((q, i) => (
          <fieldset key={i} data-testid={`triage-question-${i}`} className="space-y-1">
            <legend className="text-amber-900">
              <span className="font-medium">{q.question}</span>
              {q.reason ? <span className="text-amber-700"> — {q.reason}</span> : null}
            </legend>
            {q.kind === "yes-no" ? (
              <div className="flex gap-3" role="radiogroup" aria-label={q.question}>
                {(["Yes", "No"] as const).map((label) => (
                  <label key={label} className="inline-flex items-center gap-1">
                    <input
                      type="radio"
                      name={`triage-q-${i}`}
                      value={label}
                      checked={answers[i] === label}
                      onChange={() => updateAnswer(i, label)}
                      data-testid={`triage-q-${i}-${label.toLowerCase()}`}
                    />
                    {label}
                  </label>
                ))}
              </div>
            ) : q.kind === "single-select" ? (
              <div className="flex flex-col gap-1" role="radiogroup" aria-label={q.question}>
                {q.options!.map((opt, j) => (
                  <label key={j} className="inline-flex items-center gap-1">
                    <input
                      type="radio"
                      name={`triage-q-${i}`}
                      value={opt}
                      checked={answers[i] === opt}
                      onChange={() => updateAnswer(i, opt)}
                      data-testid={`triage-q-${i}-opt-${j}`}
                    />
                    {opt}
                  </label>
                ))}
              </div>
            ) : (
              <input
                type="text"
                value={answers[i] ?? ""}
                onChange={(e) => updateAnswer(i, e.target.value)}
                aria-label={q.question}
                placeholder="Your answer"
                className="w-full rounded border border-amber-300 bg-white px-2 py-1 text-xs text-slate-900 placeholder:text-slate-400"
                data-testid={`triage-q-${i}-text`}
              />
            )}
          </fieldset>
        ))}
      </div>
      <button
        type="submit"
        disabled={pending || !allAnswered}
        data-testid="triage-clarification-submit"
        className="mt-3 rounded-md bg-amber-700 px-3 py-1 text-xs font-medium text-white disabled:opacity-50"
      >
        {pending ? "Sending…" : "Send answers"}
      </button>
    </form>
  );
}
