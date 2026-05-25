// src/dag.ts
import type { WorkflowNode } from "./types.js";

/** DFS cycle detection. Returns the cycle path if found, or null. */
export function detectCycle(nodes: ReadonlyArray<WorkflowNode>): string[] | null {
  const byId = new Map(nodes.map((n) => [n.id, n]));
  const WHITE = 0, GRAY = 1, BLACK = 2;
  const color = new Map<string, number>(nodes.map((n) => [n.id, WHITE]));
  const stack: string[] = [];

  function visit(id: string): string[] | null {
    color.set(id, GRAY);
    stack.push(id);
    const node = byId.get(id);
    if (node) {
      for (const dep of node.dependsOn) {
        const c = color.get(dep) ?? WHITE;
        if (c === GRAY) {
          const cycleStart = stack.indexOf(dep);
          return cycleStart === -1 ? [...stack, dep] : stack.slice(cycleStart).concat(dep);
        }
        if (c === WHITE) {
          const r = visit(dep);
          if (r) return r;
        }
      }
    }
    color.set(id, BLACK);
    stack.pop();
    return null;
  }

  for (const n of nodes) {
    if ((color.get(n.id) ?? WHITE) === WHITE) {
      const r = visit(n.id);
      if (r) return r;
    }
  }
  return null;
}

/** Kahn's algorithm. Throws if a cycle exists. */
export function topoSort(nodes: ReadonlyArray<WorkflowNode>): WorkflowNode[] {
  const cycle = detectCycle(nodes);
  if (cycle) throw new Error(`topoSort: cycle detected: ${cycle.join(" → ")}`);

  const byId = new Map(nodes.map((n) => [n.id, n]));

  // Compute in-degree: count how many dependencies each node has within this set
  const inDegree = new Map<string, number>();
  for (const n of nodes) inDegree.set(n.id, 0);
  for (const n of nodes) {
    for (const dep of n.dependsOn) {
      if (byId.has(dep)) inDegree.set(n.id, (inDegree.get(n.id) ?? 0) + 1);
    }
  }

  const queue: WorkflowNode[] = [];
  for (const n of nodes) if ((inDegree.get(n.id) ?? 0) === 0) queue.push(n);

  const result: WorkflowNode[] = [];
  while (queue.length > 0) {
    const n = queue.shift()!;
    result.push(n);
    for (const m of nodes) {
      if (m.dependsOn.includes(n.id)) {
        const d = (inDegree.get(m.id) ?? 0) - 1;
        inDegree.set(m.id, d);
        if (d === 0) queue.push(m);
      }
    }
  }
  if (result.length !== nodes.length) throw new Error(`topoSort: cycle detected (incomplete sort)`);
  return result;
}

/** Nodes that are pending, not deferred, and have all dependsOn `done`. */
export function findReadyNodes(nodes: ReadonlyArray<WorkflowNode>): WorkflowNode[] {
  const byId = new Map(nodes.map((n) => [n.id, n]));
  return nodes.filter((n) => {
    if (n.status !== "pending") return false;
    if (n.policy.runMode === "deferred") return false;
    return n.dependsOn.every((dep) => byId.get(dep)?.status === "done");
  });
}
