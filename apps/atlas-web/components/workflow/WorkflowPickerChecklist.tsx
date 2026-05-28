"use client";

import { useMemo, useState } from "react";

export interface WorkflowPickerChecklistProps {
  /** Kinds suggested by the entry classifier (e.g. ["backend-rest-api", "frontend-app", "tests"]). */
  suggestedKinds: ReadonlyArray<string>;
  /** Optional classifier reasoning to display so the user understands why
   *  these kinds were proposed. */
  reasoning?: string;
  /** Called with the user's confirmed kinds (subset of suggestedKinds). */
  onConfirm: (kinds: string[]) => void | Promise<void>;
  /** Called when the user opts out of the workflow entirely and wants
   *  today's single-ritual flow instead. */
  onDowngrade?: () => void | Promise<void>;
  /** Disables both buttons (use during submit transitions). */
  pending?: boolean;
}

const KIND_LABELS: Record<string, string> = {
  "frontend-app": "Frontend",
  "backend-rest-api": "Backend (REST API)",
  "backend-graphql": "Backend (GraphQL)",
  tests: "Tests",
  iac: "Infrastructure-as-code",
  deploy: "Deploy",
  "data-pipeline": "Data pipeline",
  "mobile-app": "Mobile app",
  "cli-tool": "CLI tool"
};

function labelFor(kind: string): string {
  return KIND_LABELS[kind] ?? kind;
}

export function WorkflowPickerChecklist({
  suggestedKinds,
  reasoning,
  onConfirm,
  onDowngrade,
  pending = false
}: WorkflowPickerChecklistProps) {
  const [selected, setSelected] = useState<Record<string, boolean>>(() =>
    Object.fromEntries(suggestedKinds.map((k) => [k, true]))
  );

  const confirmedKinds = useMemo(
    () => suggestedKinds.filter((k) => selected[k]),
    [suggestedKinds, selected]
  );

  const toggle = (kind: string) =>
    setSelected((cur) => ({ ...cur, [kind]: !cur[kind] }));

  return (
    <section
      data-testid="workflow-picker-checklist"
      className="mx-auto max-w-md rounded-lg border border-slate-300 bg-white p-4 shadow-sm"
    >
      <h2 className="text-base font-semibold text-slate-900">
        Atlas thinks this needs a workflow
      </h2>
      {reasoning && (
        <p
          data-testid="workflow-picker-reasoning"
          className="mt-1 text-xs text-slate-600"
        >
          {reasoning}
        </p>
      )}
      <ul className="mt-3 space-y-2">
        {suggestedKinds.map((kind) => (
          <li key={kind}>
            <label className="flex items-center gap-2 text-sm">
              <input
                type="checkbox"
                data-testid={`picker-check-${kind}`}
                checked={Boolean(selected[kind])}
                onChange={() => toggle(kind)}
                disabled={pending}
                className="h-4 w-4"
              />
              <span className="font-medium text-slate-800">{labelFor(kind)}</span>
              <span className="ml-auto font-mono text-[10px] text-slate-500">
                {kind}
              </span>
            </label>
          </li>
        ))}
      </ul>
      <div className="mt-4 flex items-center gap-2">
        <button
          type="button"
          data-testid="workflow-picker-confirm"
          onClick={() => onConfirm(confirmedKinds)}
          disabled={pending || confirmedKinds.length === 0}
          className="flex-1 rounded-md bg-slate-900 px-3 py-2 text-sm font-semibold text-white hover:bg-slate-700 disabled:opacity-50"
        >
          {pending ? "Starting…" : "Start workflow"}
        </button>
        {onDowngrade && (
          <button
            type="button"
            data-testid="workflow-picker-downgrade"
            onClick={() => onDowngrade()}
            disabled={pending}
            className="rounded-md border border-slate-300 bg-white px-3 py-2 text-sm text-slate-700 hover:bg-slate-50 disabled:opacity-50"
          >
            Use single-ritual instead
          </button>
        )}
      </div>
      {confirmedKinds.length === 0 && (
        <p
          data-testid="workflow-picker-empty-hint"
          className="mt-2 text-[11px] text-amber-700"
        >
          Pick at least one kind, or downgrade to a single ritual.
        </p>
      )}
    </section>
  );
}
