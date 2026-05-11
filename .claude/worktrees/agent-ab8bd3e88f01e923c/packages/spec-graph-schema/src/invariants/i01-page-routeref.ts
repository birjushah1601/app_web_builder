import type { SpecGraph } from "../graph.js";
import type { Invariant, ValidationIssue } from "./runner.js";

export const i01PageRouteRef: Invariant = (graph: SpecGraph): ValidationIssue[] => {
  const issues: ValidationIssue[] = [];
  for (const [id, node] of Object.entries(graph.nodes)) {
    if (node.kind === "page" && (node.routeRef === undefined || node.routeRef === "")) {
      issues.push({
        code: "I01_PAGE_MISSING_ROUTEREF",
        message: `Page ${id} must carry a routeRef`,
        path: ["nodes", id, "routeRef"],
        nodeId: id
      });
    }
  }
  return issues;
};
