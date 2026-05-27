import type { WorkflowNode } from "@atlas/workflow-engine";

/**
 * Maps a WorkflowNode status to a Tailwind class string for use in
 * WorkflowNodeCard and any other status-coloured UI.
 *
 * Note: "blocked" uses an inline background-image for the hatched pattern
 * because Tailwind's JIT cannot generate arbitrary CSS values on-the-fly.
 * The [background-image:...] variant IS supported by Tailwind v3 arbitrary
 * properties and compiles correctly.
 */
export function nodeStatusColor(status: WorkflowNode["status"]): string {
  switch (status) {
    case "pending":
      return "bg-slate-100 border-slate-300 text-slate-700";
    case "ready":
      return "bg-amber-50 border-amber-300 text-amber-800";
    case "running":
      return "bg-indigo-100 border-indigo-400 text-indigo-900 animate-pulse";
    case "done":
      return "bg-emerald-100 border-emerald-400 text-emerald-900";
    case "failed":
      return "bg-red-100 border-red-400 text-red-900";
    case "blocked":
      return "bg-slate-200 border-slate-400 text-slate-700 [background-image:repeating-linear-gradient(45deg,transparent,transparent_4px,rgba(0,0,0,0.04)_4px,rgba(0,0,0,0.04)_8px)]";
    case "skipped":
      return "bg-slate-100 border-slate-300 border-dashed text-slate-500";
  }
}
