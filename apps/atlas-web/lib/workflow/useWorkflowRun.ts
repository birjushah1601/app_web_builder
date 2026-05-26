"use client";
import { useMemo } from "react";
import { useEventStream } from "@/lib/events/EventSourceProvider";
import type { WorkflowRunSnapshot, WorkflowNode } from "@atlas/workflow-engine";

/** Returns the live workflow snapshot, applying SSE updates on top of an
 *  initial server-rendered snapshot. */
export function useWorkflowRun(initial: WorkflowRunSnapshot): WorkflowRunSnapshot {
  const { events } = useEventStream();

  return useMemo<WorkflowRunSnapshot>(() => {
    const snap: WorkflowRunSnapshot = {
      ...initial,
      nodes: initial.nodes.map((n) => ({ ...n }))
    };
    // Walk events in order; apply each matching update
    for (const ev of events) {
      if (ev.type === "workflow.run.status_changed") {
        const p = ev.payload as { workflowRunId?: string; status?: WorkflowRunSnapshot["status"] };
        if (p.workflowRunId === initial.id && p.status) snap.status = p.status;
      } else if (ev.type === "workflow.node.status_changed") {
        const p = ev.payload as {
          workflowRunId?: string;
          nodeId?: string;
          status?: WorkflowNode["status"];
          ritualId?: string;
          artifact?: unknown;
          failure?: WorkflowNode["failure"];
        };
        if (p.workflowRunId !== initial.id || !p.nodeId) continue;
        const idx = snap.nodes.findIndex((n) => n.id === p.nodeId);
        if (idx === -1) continue;
        const cur = snap.nodes[idx]!;
        snap.nodes[idx] = {
          ...cur,
          ...(p.status ? { status: p.status } : {}),
          ...(p.ritualId ? { ritualId: p.ritualId } : {}),
          ...(p.artifact !== undefined ? { artifact: p.artifact } : {}),
          ...(p.failure ? { failure: p.failure } : {})
        };
      }
    }
    return snap;
  }, [events, initial]);
}
