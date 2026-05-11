import type { SpecGraph } from "../graph.js";
import type { Invariant, ValidationIssue } from "./runner.js";

const COVERED_KINDS = new Set(["page", "clientstate", "endpoint", "flow", "authboundary"]);

export const i09TestCoverageRequiredTargets: Invariant = (graph: SpecGraph): ValidationIssue[] => {
  const issues: ValidationIssue[] = [];
  const coveredIds = new Set<string>();
  for (const edge of graph.edges) {
    if (edge.type === "covers") coveredIds.add(edge.to);
  }
  for (const [id, node] of Object.entries(graph.nodes)) {
    if (!COVERED_KINDS.has(node.kind)) continue;
    if (!coveredIds.has(id)) {
      issues.push({
        code: "I09_MISSING_TEST_COVERAGE",
        message: `${node.kind} ${id} has no covers-edge from any Test`,
        path: ["edges"],
        nodeId: id
      });
    }
  }
  return issues;
};
