"use client";

import { useState, useTransition } from "react";
import type { WorkflowRunSnapshot } from "@atlas/workflow-engine";
import { abortWorkflow } from "@/lib/actions/abortWorkflow";

export interface WorkflowHeaderProps {
  snapshot: WorkflowRunSnapshot;
  projectId: string;
}

const STATUS_CLASS: Record<WorkflowRunSnapshot["status"], string> = {
  planning: "bg-slate-100 text-slate-700 border-slate-300",
  awaiting_approval: "bg-amber-100 text-amber-800 border-amber-300",
  running: "bg-indigo-100 text-indigo-900 border-indigo-300",
  completed: "bg-emerald-100 text-emerald-900 border-emerald-300",
  escalated: "bg-orange-100 text-orange-900 border-orange-300",
  aborted: "bg-slate-200 text-slate-700 border-slate-400"
};

export function WorkflowHeader({ snapshot, projectId }: WorkflowHeaderProps) {
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);

  const canAbort =
    snapshot.status === "running" ||
    snapshot.status === "awaiting_approval" ||
    snapshot.status === "planning";

  const onAbort = () => {
    if (!canAbort) return;
    if (typeof window !== "undefined" && !window.confirm("Abort this workflow?")) return;
    setError(null);
    startTransition(async () => {
      try {
        await abortWorkflow({ projectId, workflowRunId: snapshot.id });
      } catch (err) {
        setError(err instanceof Error ? err.message : String(err));
      }
    });
  };

  return (
    <header
      data-testid="workflow-header"
      className="flex items-center gap-3 border-b border-slate-200 bg-white px-4 py-2"
    >
      <div className="min-w-0 flex-1">
        <div className="truncate text-sm font-semibold text-slate-900">
          {snapshot.prompt || "Workflow"}
        </div>
        <div className="font-mono text-[10px] text-slate-500">{snapshot.id}</div>
      </div>
      <span
        data-testid="workflow-status-badge"
        className={`rounded-md border px-2 py-0.5 text-[11px] font-medium uppercase tracking-wide ${STATUS_CLASS[snapshot.status]}`}
      >
        {snapshot.status.replace(/_/g, " ")}
      </span>
      {canAbort && (
        <button
          type="button"
          onClick={onAbort}
          disabled={pending}
          data-testid="workflow-abort-btn"
          className="rounded-md border border-red-300 bg-white px-2 py-1 text-xs text-red-700 hover:bg-red-50 disabled:opacity-50"
        >
          {pending ? "Aborting…" : "Abort"}
        </button>
      )}
      {error && (
        <span data-testid="workflow-abort-error" className="text-[11px] text-red-700">
          {error}
        </span>
      )}
    </header>
  );
}
