# Plan C — Graph View UI + Drill-In Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Ship the graph view UI for workflows — a node-graph rendering with status colors, per-node policy controls, drill-in to existing per-ritual UI, approval gate, and workflow chat panel. Users go from "real workflows happen in DB and logs" (Plan B) to "real workflows are visible and controllable from the canvas page" (this plan).

**Architecture:** New Next.js route `/projects/[id]/workflow/[workflowId]` server-renders an initial snapshot, hydrates with a client component that subscribes to SSE for live updates. Graph rendering uses `@xyflow/react` (mature, well-tested React DAG library). Drill-in opens a nested route `/node/[nodeId]` that mounts today's per-ritual UI scoped to that node's ritualId. Per-node context menu calls the Server Actions from Plan A (`retryNode`, `setNodePolicy`, etc.). Approval gate uses the existing `plan-approval` canvas-pause kind from Plan UXO.

**Tech Stack:** Next.js 15 App Router, React 19, `@xyflow/react` (new dep), the existing `useEventStream` SSE provider, the existing canvas-mode-registry for per-node renderers.

**Spec reference:** Section 8 (Multi-sandbox UX), Section 9 (Picker checklist UI).

**Depends on:** Plans A + B merged.

---

## File Structure

### New routes + pages
| Path | Responsibility |
|---|---|
| `apps/atlas-web/app/projects/[projectId]/workflow/[workflowId]/page.tsx` | Server-renders initial workflow snapshot; mounts `WorkflowGraphClient` |
| `apps/atlas-web/app/projects/[projectId]/workflow/[workflowId]/node/[nodeId]/page.tsx` | Server-renders the per-node ritual view (reuses today's canvas-page tree) scoped to that node's ritualId |
| `apps/atlas-web/app/projects/[projectId]/workflow/[workflowId]/loading.tsx` | Standard Next.js loading state |

### New client components
| Path | Responsibility |
|---|---|
| `apps/atlas-web/components/workflow/WorkflowGraphClient.tsx` | Top-level client: subscribes to SSE; renders graph |
| `apps/atlas-web/components/workflow/WorkflowGraph.tsx` | @xyflow/react graph; receives nodes + edges + handlers |
| `apps/atlas-web/components/workflow/WorkflowNodeCard.tsx` | Custom xyflow node renderer with status color + summary + context menu trigger |
| `apps/atlas-web/components/workflow/WorkflowNodeContextMenu.tsx` | Right-click / "…" menu (retry, prioritize, background, defer, skip, open logs) |
| `apps/atlas-web/components/workflow/WorkflowApprovalPanel.tsx` | Edit + approve the proposed DAG between planning and execute |
| `apps/atlas-web/components/workflow/WorkflowPickerChecklist.tsx` | The "Backend [✓] Frontend [✓]..." checklist (Plan 9 flag-gated) |
| `apps/atlas-web/components/workflow/WorkflowChatPanel.tsx` | Workflow-level conversation (planner Q&A, completion summary) |
| `apps/atlas-web/components/workflow/WorkflowHeader.tsx` | Title + status + abort button + cost (Plan G plumbs cost) |

### New hooks
| Path | Responsibility |
|---|---|
| `apps/atlas-web/lib/workflow/useWorkflowRun.ts` | Subscribes to SSE filtered by workflowRunId; returns live snapshot |
| `apps/atlas-web/lib/workflow/useWorkflowApprovalPending.ts` | Returns true when workflow is `awaiting_approval` |
| `apps/atlas-web/lib/workflow/useNodeStatusColor.ts` | Maps NodeStatus → tailwind class |

### Modifications
| File | Change |
|---|---|
| `apps/atlas-web/package.json` | Add `@xyflow/react` dep |
| `apps/atlas-web/app/projects/[projectId]/page.tsx` | When project has an open workflow, redirect to the workflow view by default |
| `apps/atlas-web/components/canvas/CanvasModeRegistry.ts` | Add per-artifact-kind renderer stubs for non-frontend kinds (Plans D-F flesh them out): Swagger UI for backend, results-panel for tests, topology for iac, deploy-status for deploy |
| `apps/atlas-web/lib/events/EventBroker.ts` | Add workflow events to the type union: `workflow.run.status_changed`, `workflow.node.status_changed` |
| `packages/workflow-engine/src/engine.ts` | Emit `workflow.run.status_changed` + `workflow.node.status_changed` events through the broker on every status transition |

---

## Tasks

### Task 1: Install @xyflow/react

- [ ] Add to `apps/atlas-web/package.json`:
```json
"@xyflow/react": "^12.3.0"
```
- [ ] `pnpm install`
- [ ] Commit: `chore(atlas-web): add @xyflow/react dep`

---

### Task 2: New SSE event types for workflow status

**Files:**
- Modify: `apps/atlas-web/lib/events/EventBroker.ts`
- Modify: `packages/ritual-engine/src/events.ts` (if engine-emitted events use that schema)
- Modify: `packages/workflow-engine/src/engine.ts` — emit on every status change

- [ ] **Step 1: Add event types to broker union**

```ts
// EventBroker.ts — add to RitualEventType
| "workflow.run.status_changed"
| "workflow.node.status_changed"
```

- [ ] **Step 2: Engine emits on status transitions**

In `WorkflowEngine`, every place that calls `runRepo.updateStatus()` or `nodeRepo.updateStatus()` should ALSO publish a broker event:

```ts
await this.opts.broker.publish({
  projectId: run.projectId,
  ritualId: run.id, // workflowRunId reused as the SSE event ritualId field
  type: "workflow.run.status_changed",
  payload: { workflowRunId: run.id, status: newStatus },
  ts: Date.now()
});

await this.opts.broker.publish({
  projectId: run.projectId,
  ritualId: run.id,
  type: "workflow.node.status_changed",
  payload: { workflowRunId: run.id, nodeId, status: newStatus, ritualId, artifact, failure },
  ts: Date.now()
});
```

- [ ] **Step 3: Tests + commit**

```bash
pnpm --filter atlas-web test EventBroker.types
git add packages/workflow-engine packages/ritual-engine apps/atlas-web/lib/events
git commit -m "feat(workflow-engine): emit workflow.run/node.status_changed SSE events"
```

---

### Task 3: useWorkflowRun hook

**Files:**
- Create: `apps/atlas-web/lib/workflow/useWorkflowRun.ts`
- Test: `apps/atlas-web/test/lib/workflow/useWorkflowRun.test.tsx`

- [ ] **Step 1: Implement**

```ts
// apps/atlas-web/lib/workflow/useWorkflowRun.ts
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
```

- [ ] **Step 2: Tests + commit**

Test: feed a synthetic event stream + initial snapshot; assert node/run statuses update.

---

### Task 4: WorkflowGraph (xyflow renderer)

**Files:**
- Create: `apps/atlas-web/components/workflow/WorkflowGraph.tsx`
- Create: `apps/atlas-web/components/workflow/WorkflowNodeCard.tsx`
- Create: `apps/atlas-web/lib/workflow/useNodeStatusColor.ts`

- [ ] **Step 1: useNodeStatusColor (small utility)**

```ts
// useNodeStatusColor.ts
import type { WorkflowNode } from "@atlas/workflow-engine";

export function nodeStatusColor(status: WorkflowNode["status"]): string {
  switch (status) {
    case "pending": return "bg-slate-100 border-slate-300 text-slate-700";
    case "ready": return "bg-amber-50 border-amber-300 text-amber-800";
    case "running": return "bg-indigo-100 border-indigo-400 text-indigo-900 animate-pulse";
    case "done": return "bg-emerald-100 border-emerald-400 text-emerald-900";
    case "failed": return "bg-red-100 border-red-400 text-red-900";
    case "blocked": return "bg-slate-200 border-slate-400 text-slate-700 [background-image:repeating-linear-gradient(45deg,transparent,transparent_4px,rgba(0,0,0,0.04)_4px,rgba(0,0,0,0.04)_8px)]";
    case "skipped": return "bg-slate-100 border-slate-300 border-dashed text-slate-500";
  }
}
```

- [ ] **Step 2: WorkflowNodeCard (custom xyflow node)**

```tsx
// WorkflowNodeCard.tsx
"use client";
import { Handle, Position, type NodeProps } from "@xyflow/react";
import type { WorkflowNode } from "@atlas/workflow-engine";
import { nodeStatusColor } from "@/lib/workflow/useNodeStatusColor";

export type WorkflowNodeData = {
  node: WorkflowNode;
  projectId: string;
  workflowRunId: string;
  onOpenMenu: (nodeId: string, anchor: HTMLElement) => void;
};

export function WorkflowNodeCard({ data }: NodeProps<WorkflowNodeData>) {
  const { node, projectId, workflowRunId, onOpenMenu } = data;
  return (
    <div data-testid={`workflow-node-${node.id}`} className={`min-w-[180px] rounded-md border-2 px-3 py-2 text-xs ${nodeStatusColor(node.status)}`}>
      <Handle type="target" position={Position.Top} />
      <div className="flex items-start justify-between gap-2">
        <div className="flex-1 min-w-0">
          <div className="font-semibold truncate">{node.summary}</div>
          <div className="text-[10px] opacity-70 mt-0.5 font-mono">{node.artifactKind}</div>
        </div>
        <button
          type="button"
          aria-label={`Node menu for ${node.id}`}
          onClick={(e) => onOpenMenu(node.id, e.currentTarget)}
          className="px-1 text-base leading-none hover:opacity-70"
        >
          ⋯
        </button>
      </div>
      <div className="mt-1 text-[10px] uppercase tracking-wide opacity-60">{node.status}</div>
      {node.policy.runMode === "background" && <div className="mt-1 text-[10px]">🔔 will notify</div>}
      <Handle type="source" position={Position.Bottom} />
    </div>
  );
}
```

- [ ] **Step 3: WorkflowGraph wrapper**

```tsx
// WorkflowGraph.tsx
"use client";
import { useMemo, useState, useCallback } from "react";
import { ReactFlow, Background, Controls, type Node, type Edge } from "@xyflow/react";
import "@xyflow/react/dist/style.css";
import type { WorkflowRunSnapshot } from "@atlas/workflow-engine";
import { WorkflowNodeCard, type WorkflowNodeData } from "./WorkflowNodeCard";
import { WorkflowNodeContextMenu } from "./WorkflowNodeContextMenu";
import Link from "next/link";

const nodeTypes = { workflow: WorkflowNodeCard };

export function WorkflowGraph({
  snapshot,
  projectId
}: { snapshot: WorkflowRunSnapshot; projectId: string }) {
  const [menuFor, setMenuFor] = useState<{ nodeId: string; anchor: HTMLElement } | null>(null);

  const openMenu = useCallback((nodeId: string, anchor: HTMLElement) => {
    setMenuFor({ nodeId, anchor });
  }, []);

  const nodes: Node<WorkflowNodeData>[] = useMemo(() => {
    return layoutNodes(snapshot.nodes).map((n, i) => ({
      id: n.id,
      type: "workflow",
      position: { x: (i % 4) * 240, y: Math.floor(i / 4) * 140 }, // crude grid; replaced by dagre in Step 4
      data: { node: n, projectId, workflowRunId: snapshot.id, onOpenMenu: openMenu }
    }));
  }, [snapshot, projectId, openMenu]);

  const edges: Edge[] = useMemo(() => {
    const out: Edge[] = [];
    for (const n of snapshot.nodes) {
      for (const dep of n.dependsOn) {
        out.push({ id: `${dep}->${n.id}`, source: dep, target: n.id });
      }
    }
    return out;
  }, [snapshot]);

  return (
    <div data-testid="workflow-graph" className="h-full w-full relative">
      <ReactFlow nodes={nodes} edges={edges} nodeTypes={nodeTypes} fitView>
        <Background />
        <Controls />
      </ReactFlow>
      {menuFor && (
        <WorkflowNodeContextMenu
          projectId={projectId}
          workflowRunId={snapshot.id}
          nodeId={menuFor.nodeId}
          anchor={menuFor.anchor}
          node={snapshot.nodes.find((n) => n.id === menuFor.nodeId)!}
          onClose={() => setMenuFor(null)}
        />
      )}
    </div>
  );
}

// Simple grid layout; can be upgraded to dagre later.
function layoutNodes<T extends { id: string; dependsOn: string[] }>(nodes: T[]): T[] {
  // For Plan C v1 — just topo order. Dagre/elkjs upgrade is a polish task.
  const inDegree = new Map(nodes.map((n) => [n.id, 0]));
  for (const n of nodes) for (const d of n.dependsOn) inDegree.set(n.id, (inDegree.get(n.id) ?? 0) + 1);
  const queue = nodes.filter((n) => (inDegree.get(n.id) ?? 0) === 0);
  const sorted: T[] = [];
  while (queue.length) {
    const n = queue.shift()!;
    sorted.push(n);
    for (const m of nodes) {
      if (m.dependsOn.includes(n.id)) {
        const d = (inDegree.get(m.id) ?? 0) - 1;
        inDegree.set(m.id, d);
        if (d === 0) queue.push(m);
      }
    }
  }
  return sorted;
}
```

- [ ] **Step 4: Tests + commit**

E2E test (playwright) that mounts the graph with a synthetic snapshot and asserts the node cards render with correct status classes.

```bash
git add apps/atlas-web/components/workflow/WorkflowGraph.tsx apps/atlas-web/components/workflow/WorkflowNodeCard.tsx apps/atlas-web/lib/workflow/useNodeStatusColor.ts
git commit -m "feat(atlas-web): WorkflowGraph + WorkflowNodeCard (xyflow renderer)"
```

---

### Task 5: WorkflowNodeContextMenu

**Files:**
- Create: `apps/atlas-web/components/workflow/WorkflowNodeContextMenu.tsx`

A floating menu anchored to the node card's `⋯` button. Actions:
- Open ritual logs → `<Link>` to `/projects/[id]/workflow/[wid]/node/[nodeId]`
- Retry node (only when `status === "failed"`) → calls `retryNode` Server Action
- Prioritize → calls `setNodePolicy` with `priority: 100`
- Run in background ⇄ Active → calls `setNodePolicy` with `runMode` flipped
- Defer / Resume from deferred → calls `deferNode` / `resumeDeferredNode`
- Skip permanently — confirmation dialog → calls `setNodePolicy` with `runMode: "skipped"` (extend the enum if needed) OR special API; Plan C v1 just shows a "(Plan G)" disabled stub if implementation lift is high

- [ ] Implement + commit (`feat(atlas-web): WorkflowNodeContextMenu (retry/prioritize/background/defer/open-logs)`)

---

### Task 6: WorkflowGraphClient + page server-render

**Files:**
- Create: `apps/atlas-web/components/workflow/WorkflowGraphClient.tsx`
- Create: `apps/atlas-web/app/projects/[projectId]/workflow/[workflowId]/page.tsx`

- [ ] **Step 1: Client wrapper**

```tsx
// WorkflowGraphClient.tsx
"use client";
import { useWorkflowRun } from "@/lib/workflow/useWorkflowRun";
import { WorkflowGraph } from "./WorkflowGraph";
import { WorkflowApprovalPanel } from "./WorkflowApprovalPanel";
import { WorkflowHeader } from "./WorkflowHeader";
import { WorkflowChatPanel } from "./WorkflowChatPanel";
import type { WorkflowRunSnapshot } from "@atlas/workflow-engine";

export function WorkflowGraphClient({
  initial,
  projectId
}: { initial: WorkflowRunSnapshot; projectId: string }) {
  const snap = useWorkflowRun(initial);
  return (
    <div className="flex h-full flex-col">
      <WorkflowHeader snapshot={snap} projectId={projectId} />
      <div className="flex flex-1 min-h-0">
        <div className="flex-1 relative">
          {snap.status === "awaiting_approval" && <WorkflowApprovalPanel snapshot={snap} projectId={projectId} />}
          <WorkflowGraph snapshot={snap} projectId={projectId} />
        </div>
        <WorkflowChatPanel snapshot={snap} projectId={projectId} />
      </div>
    </div>
  );
}
```

- [ ] **Step 2: Server-render the initial snapshot**

```tsx
// page.tsx
import { getWorkflowRun } from "@/lib/actions/getWorkflowRun";
import { WorkflowGraphClient } from "@/components/workflow/WorkflowGraphClient";
import { notFound } from "next/navigation";

export default async function WorkflowPage({ params }: { params: Promise<{ projectId: string; workflowId: string }> }) {
  const { projectId, workflowId } = await params;
  const initial = await getWorkflowRun({ workflowRunId: workflowId });
  if (!initial) notFound();
  if (initial.projectId !== projectId) notFound();
  return <WorkflowGraphClient initial={initial} projectId={projectId} />;
}
```

- [ ] **Step 3: Commit** (`feat(atlas-web): workflow page route + client shell`)

---

### Task 7: WorkflowApprovalPanel

**Files:**
- Create: `apps/atlas-web/components/workflow/WorkflowApprovalPanel.tsx`

When `snapshot.status === "awaiting_approval"`, render an overlay with:
- The proposed DAG visible underneath (already rendered by WorkflowGraph)
- A side panel listing nodes with inline edit:
  - Rename summary
  - Toggle `runMode` (active/background/deferred)
  - Reorder priority
- An "Approve" button → calls `approveWorkflowPlan({ workflowRunId, edits })`
- An "Edit dependencies" button toggles edge-edit mode (drag handles to add/remove edges)

For Plan C v1, skip the dependency-edit mode (too much UI lift); just allow summary/runMode/priority edits. Edge editing is a future polish task.

- [ ] Implement + commit (`feat(atlas-web): WorkflowApprovalPanel — edit + approve proposed DAG`)

---

### Task 8: WorkflowChatPanel

**Files:**
- Create: `apps/atlas-web/components/workflow/WorkflowChatPanel.tsx`

Slim right-side panel. Shows:
- The original prompt (read-only at top)
- Planner Q&A history (read from snapshot.nodes[planner] events via the existing `useTriageClarifications` hook from Plan U slice 3b — works here unchanged because the planner uses the same canvas-pause kind)
- "Completion summary" once workflow.status = completed (renders aggregated node summaries)
- A textarea for follow-up prompts:
  - "Add a node" — opens a small dialog → calls a new Server Action `addNodeToWorkflow` (Plan C scope OR defer to Plan G — implementer's call based on time)
  - "Retry workflow" — calls `retryNode` for every failed node
  - Free text → creates a NEW workflow run (refinement, treated as a new cold-start in v1 per Section 11 re-running policy)

For Plan C v1: just render history + free-text follow-up that creates a new workflow run. Add-node/Retry-all are polish tasks.

- [ ] Implement + commit

---

### Task 9: Per-node drill-in route

**Files:**
- Create: `apps/atlas-web/app/projects/[projectId]/workflow/[workflowId]/node/[nodeId]/page.tsx`

Drills into a node — renders today's per-ritual canvas tree scoped to the node's ritualId.

- [ ] **Step 1: Implementation**

```tsx
// page.tsx
import { getWorkflowRun } from "@/lib/actions/getWorkflowRun";
import { notFound } from "next/navigation";
import { CanvasShellWired } from "@/components/canvas/CanvasShellWired";
// Reuse existing canvas-page imports for renderers, etc.

export default async function NodePage({
  params
}: {
  params: Promise<{ projectId: string; workflowId: string; nodeId: string }>;
}) {
  const { projectId, workflowId, nodeId } = await params;
  const snap = await getWorkflowRun({ workflowRunId: workflowId });
  if (!snap || snap.projectId !== projectId) notFound();
  const node = snap.nodes.find((n) => n.id === nodeId);
  if (!node) notFound();
  // If the node has a ritualId, mount today's canvas tree scoped to it.
  // The CanvasShellWired's hooks (useDesignerProposal, useCanvasManifest)
  // filter by ritualId via the SSE stream; pass node.ritualId here.
  return (
    <div className="h-full">
      <BreadcrumbBar projectId={projectId} workflowId={workflowId} node={node} />
      {node.ritualId ? (
        <CanvasShellWired projectId={projectId} ritualIdOverride={node.ritualId} persona="ama" />
      ) : (
        <div className="p-8 text-sm text-slate-600">
          Node hasn&apos;t started yet (status: {node.status}). Per-node view will populate once the ritual launches.
        </div>
      )}
    </div>
  );
}

function BreadcrumbBar({ projectId, workflowId, node }: any) {
  return (
    <nav className="flex items-center gap-2 border-b border-slate-200 px-3 py-2 text-xs">
      <a href={`/projects/${projectId}/workflow/${workflowId}`}>← Workflow</a>
      <span className="text-slate-400">/</span>
      <span className="font-semibold">{node.summary}</span>
      <span className="text-slate-400">({node.artifactKind})</span>
    </nav>
  );
}
```

- [ ] **Step 2: Add `ritualIdOverride` prop to CanvasShellWired**

(Today's `CanvasShellWired` derives ritualId from the most recent project ritual in SSE. Adding an explicit override prop is a small change to make this composable with the workflow per-node view.)

- [ ] **Step 3: Commit** (`feat(atlas-web): per-node drill-in route using existing CanvasShellWired`)

---

### Task 10: WorkflowPickerChecklist (the `ATLAS_FF_WORKFLOW_PICKER` UI)

**Files:**
- Create: `apps/atlas-web/components/workflow/WorkflowPickerChecklist.tsx`
- Modify: `apps/atlas-web/app/projects/new/_components/PromptForm.tsx` — when `startBuild` returns `{ kind: "workflow" }` AND `ATLAS_FF_WORKFLOW_PICKER` is on, render this checklist before redirecting to the workflow page

The checklist:
- Shows each suggested kind with a check
- Allows the user to untick kinds or click "Use single-ritual instead"
- Submitting confirms the kinds → re-calls `startWorkflow` (or `startRitual` for the downgrade case)

- [ ] Implement + commit (`feat(atlas-web): WorkflowPickerChecklist — flag-gated kind override`)

---

### Task 11: Per-kind canvas renderers (stubs)

**Files:**
- Modify: `apps/atlas-web/components/canvas/register-renderers.ts` (or wherever canvas modes are registered)

Add stub renderers for non-frontend artifact kinds. These render placeholder content until Plans D/E/F flesh them out:

- `backend-rest-api` → "Backend running on {sandbox.previewUrl}. (Swagger UI lands in Plan D)"
- `tests` → "Test results panel lands in Plan E"
- `iac` → "Topology + compose viewer lands in Plan F"
- `deploy` → "Deploy status panel lands in Plan F"

- [ ] Implement + commit (`feat(atlas-web): stub renderers for non-frontend artifact kinds`)

---

### Task 12: E2E tests

**Files:**
- Create: `apps/atlas-web/e2e/tests/workflow-graph-view.spec.ts`
- Create: `apps/atlas-web/e2e/tests/workflow-approval.spec.ts`
- Create: `apps/atlas-web/e2e/tests/workflow-drill-in.spec.ts`

Tests:
- Graph renders all nodes from a seeded workflow; statuses applied correctly
- Approval panel appears when status=awaiting_approval; approving advances status to running
- Drill-in routes to a per-node canvas; back navigation works
- SSE-driven status updates: seed a workflow, simulate a status event, assert the node card color flips live

- [ ] Implement + commit

---

## Plan C — Self-review checklist

- [ ] Spec section 8 (graph view + node states + drill-in + context menu + background mode + chat panel) → Tasks 4, 5, 8, 9
- [ ] Spec section 8 (approval gate UI) → Task 7
- [ ] Spec section 8 (per-node preview renderer per artifact kind) → Task 11 (stubs); Plans D-F flesh them out
- [ ] Spec section 9 (picker checklist) → Task 10

**Shippable result:** Real workflows are now fully visible and controllable from the canvas. Users can run a workflow end-to-end (with frontend kind working real; backend/tests/iac/deploy still stub renderers) and see live progress per node.
