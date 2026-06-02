"use client";

import { useState, useTransition } from "react";
import type { WorkflowRunSnapshot } from "@atlas/workflow-engine";
import { abortWorkflow } from "@/lib/actions/abortWorkflow";
import { retryAllFailedNodes } from "@/lib/actions/retryAllFailedNodes";

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

function costColorClass(total: number, cap: number | undefined): string {
  if (cap === undefined || cap <= 0) return "text-slate-700";
  const ratio = total / cap;
  if (ratio >= 1.0) return "text-red-700";
  if (ratio >= 0.8) return "text-amber-700";
  return "text-slate-700";
}

export function WorkflowHeader({ snapshot, projectId }: WorkflowHeaderProps) {
  const [pending, startTransition] = useTransition();
  const [retryAllPending, startRetryAllTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);

  const canAbort =
    snapshot.status === "running" ||
    snapshot.status === "awaiting_approval" ||
    snapshot.status === "planning";

  const failedNodes = snapshot.nodes.filter((n) => n.status === "failed");
  const canRetryAll =
    snapshot.status === "escalated" && failedNodes.length > 0;

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

  const onRetryAll = () => {
    if (!canRetryAll) return;
    setError(null);
    startRetryAllTransition(async () => {
      try {
        await retryAllFailedNodes({ projectId, workflowRunId: snapshot.id });
      } catch (err) {
        setError(err instanceof Error ? err.message : String(err));
      }
    });
  };

  const totalCostUsd = snapshot.totalCostUsd;
  const costCapUsd = snapshot.costCapUsd;
  const showCost = totalCostUsd !== undefined;
  // Plan G.3 — per-role cost breakdown. Render a <details>/<summary>
  // disclosure ONLY when there's actually something to show; empty arrays
  // and undefined both fall through to "no disclosure".
  const costBreakdown = snapshot.costBreakdown;
  const showBreakdown = !!costBreakdown && costBreakdown.length > 0;

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
      {showCost && (
        <span
          data-testid="workflow-running-cost"
          className={`font-mono text-[11px] tabular-nums ${costColorClass(totalCostUsd, costCapUsd)}`}
        >
          {costCapUsd !== undefined
            ? `$${totalCostUsd.toFixed(2)} / $${costCapUsd.toFixed(2)}`
            : `$${totalCostUsd.toFixed(2)}`}
        </span>
      )}
      {showBreakdown && (
        <details
          data-testid="workflow-cost-breakdown"
          className="text-[11px]"
        >
          <summary className="cursor-pointer select-none text-slate-600 hover:text-slate-900">
            by role
          </summary>
          <ul className="absolute right-2 z-10 mt-1 min-w-[180px] rounded-md border border-slate-200 bg-white p-2 shadow-md">
            {costBreakdown!.map((row) => (
              <li
                key={row.roleId}
                data-testid="workflow-cost-breakdown-row"
                className="flex items-center justify-between gap-3 py-0.5 font-mono tabular-nums"
              >
                <span className="text-slate-700">{row.roleId}</span>
                <span className="text-slate-900">${row.totalUsd.toFixed(2)}</span>
                <span className="text-slate-500">({row.callCount})</span>
              </li>
            ))}
          </ul>
        </details>
      )}
      <span
        data-testid="workflow-status-badge"
        className={`rounded-md border px-2 py-0.5 text-[11px] font-medium uppercase tracking-wide ${STATUS_CLASS[snapshot.status]}`}
      >
        {snapshot.status.replace(/_/g, " ")}
      </span>
      {canRetryAll && (
        <button
          type="button"
          onClick={onRetryAll}
          disabled={retryAllPending}
          data-testid="workflow-retry-all-btn"
          className="rounded-md border border-indigo-300 bg-white px-2 py-1 text-xs text-indigo-700 hover:bg-indigo-50 disabled:opacity-50"
        >
          {retryAllPending
            ? "Retrying…"
            : `Retry all failed (${failedNodes.length})`}
        </button>
      )}
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
