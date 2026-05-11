/**
 * Thrown when `topoSort` detects a cycle in the skill composition graph.
 */
export class CyclicDependencyError extends Error {
  /** The names of the nodes involved in the cycle, in detection order. */
  readonly cycle: string[];

  constructor(cycle: string[]) {
    super(`Cyclic skill dependency detected: ${cycle.join(" → ")}`);
    this.name = "CyclicDependencyError";
    this.cycle = cycle;
  }
}

/**
 * Kahn's algorithm topological sort.
 *
 * The input `graph` maps each node to its direct dependencies:
 *   `{ a: ["b"], b: ["c"], c: [] }` means a depends on b, b depends on c.
 *
 * Output is dependency-first (leaves first, roots last):
 *   ["c", "b", "a"]
 *
 * @param graph - An adjacency map `{ node: [dependency, ...] }`.
 * @returns     - Nodes in dependency-first order.
 * @throws      - `CyclicDependencyError` if the graph contains a cycle.
 */
export function topoSort(graph: Record<string, string[]>): string[] {
  // Collect all nodes
  const allNodes = new Set<string>(Object.keys(graph));
  for (const deps of Object.values(graph)) {
    for (const dep of deps) allNodes.add(dep);
  }

  // outDeg[n] = number of dependencies n has (how many nodes n points to)
  // A node with outDeg=0 is a leaf (no dependencies) — these come first.
  const outDeg = new Map<string, number>();
  for (const node of allNodes) {
    outDeg.set(node, (graph[node] ?? []).length);
  }

  // reverseDeps[dep] = list of nodes that list dep as a dependency
  // When dep is "consumed" (added to order), we reduce the outDeg of each such node.
  const reverseDeps = new Map<string, string[]>();
  for (const node of allNodes) {
    if (!reverseDeps.has(node)) reverseDeps.set(node, []);
  }
  for (const [node, deps] of Object.entries(graph)) {
    for (const dep of deps) {
      if (!reverseDeps.has(dep)) reverseDeps.set(dep, []);
      reverseDeps.get(dep)!.push(node);
    }
  }

  // Seed with leaves (outDeg = 0)
  const queue: string[] = [];
  for (const [node, deg] of outDeg) {
    if (deg === 0) queue.push(node);
  }

  const order: string[] = [];
  while (queue.length > 0) {
    queue.sort();
    const node = queue.shift()!;
    order.push(node);

    // For each node that depends on the just-emitted node,
    // decrement its remaining-dependency count.
    for (const dependent of (reverseDeps.get(node) ?? [])) {
      const newDeg = (outDeg.get(dependent) ?? 0) - 1;
      outDeg.set(dependent, newDeg);
      if (newDeg === 0) queue.push(dependent);
    }
  }

  if (order.length !== allNodes.size) {
    // Remaining non-zero outDeg nodes are in the cycle
    const remaining = [...outDeg.entries()]
      .filter(([, deg]) => deg > 0)
      .map(([n]) => n);
    throw new CyclicDependencyError(remaining);
  }

  return order;
}
