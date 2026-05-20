import type { SpecGraph } from "../graph.js";
import type { Invariant, ValidationIssue } from "./runner.js";

export const i03PageAuthRequiredNeedsBoundary: Invariant = (graph: SpecGraph): ValidationIssue[] => {
  const issues: ValidationIssue[] = [];
  for (const [id, node] of Object.entries(graph.nodes)) {
    if (node.kind !== "page") continue;
    if (!node.authRequired) continue;
    const hasRequires = graph.edges.some(
      (e) => e.type === "requires" && e.from === id && graph.nodes[e.to]?.kind === "authboundary"
    );
    if (!hasRequires) {
      issues.push({
        code: "I03_AUTH_PAGE_MISSING_BOUNDARY",
        message: `Page ${id} has authRequired=true but no requires-edge to an AuthBoundary`,
        path: ["edges"],
        nodeId: id
      });
    }
  }
  return issues;
};
