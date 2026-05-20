import type { SpecGraph } from "../graph.js";
import type { Invariant, ValidationIssue } from "./runner.js";

export const i07RendersTargetExists: Invariant = (graph: SpecGraph): ValidationIssue[] => {
  const issues: ValidationIssue[] = [];
  graph.edges.forEach((edge, idx) => {
    if (edge.type !== "renders") return;
    const target = graph.nodes[edge.to];
    if (!target) {
      issues.push({
        code: "I07_RENDERS_DANGLING_REF",
        message: `renders edge from ${edge.from} points at non-existent node ${edge.to}`,
        path: ["edges", idx, "to"],
        edgeIndex: idx
      });
    } else if (target.kind !== "component") {
      issues.push({
        code: "I07_RENDERS_WRONG_KIND",
        message: `renders edge from ${edge.from} points at ${edge.to} which is a ${target.kind}, not a component`,
        path: ["edges", idx, "to"],
        edgeIndex: idx
      });
    }
  });
  return issues;
};
