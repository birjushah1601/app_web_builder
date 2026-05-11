import type { SpecGraph } from "../graph.js";
import type { Invariant, ValidationIssue } from "./runner.js";

export const i13BaselineTestsForProtectedTargets: Invariant = (graph: SpecGraph): ValidationIssue[] => {
  const issues: ValidationIssue[] = [];
  // Build map of which target ids are covered by a baseline-source Test.
  const baselineCoverage = new Set<string>();
  for (const node of Object.values(graph.nodes)) {
    if (node.kind !== "test" || node.source !== "baseline") continue;
    for (const target of node.coversRef) baselineCoverage.add(target);
  }

  const protectedNeedsBaseline = (id: string): boolean => {
    const node = graph.nodes[id];
    if (!node) return false;
    if (node.kind === "authboundary") return true;
    if (node.kind === "model" && node.piiClassification !== "none") return true;
    if (node.kind === "compliance" && node.name !== "baseline") return true;
    return false;
  };

  for (const [id, node] of Object.entries(graph.nodes)) {
    if (!protectedNeedsBaseline(id)) continue;
    if (!baselineCoverage.has(id)) {
      issues.push({
        code: "I13_PROTECTED_TARGET_MISSING_BASELINE_TEST",
        message: `${node.kind} ${id} requires at least one Test with source="baseline" (non-overridable security floor)`,
        path: ["nodes", id],
        nodeId: id
      });
    }
  }
  return issues;
};
