import type { SpecGraph } from "../graph.js";
import type { Invariant, ValidationIssue } from "./runner.js";

export const i02EndpointRouteRef: Invariant = (graph: SpecGraph): ValidationIssue[] => {
  const issues: ValidationIssue[] = [];
  for (const [id, node] of Object.entries(graph.nodes)) {
    if (node.kind === "endpoint" && (node.routeRef === undefined || node.routeRef === "")) {
      issues.push({
        code: "I02_ENDPOINT_MISSING_ROUTEREF",
        message: `Endpoint ${id} must carry a routeRef`,
        path: ["nodes", id, "routeRef"],
        nodeId: id
      });
    }
  }
  return issues;
};
