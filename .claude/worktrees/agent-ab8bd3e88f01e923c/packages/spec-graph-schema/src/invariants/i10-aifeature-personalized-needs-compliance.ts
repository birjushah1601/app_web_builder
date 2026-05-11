import type { SpecGraph } from "../graph.js";
import type { Invariant, ValidationIssue } from "./runner.js";

export const i10AiFeaturePersonalizedNeedsCompliance: Invariant = (graph: SpecGraph): ValidationIssue[] => {
  const issues: ValidationIssue[] = [];
  for (const [id, node] of Object.entries(graph.nodes)) {
    if (node.kind !== "aifeature") continue;
    if (node.personalization === "none") continue;
    const hasCompliance = graph.edges.some(
      (e) => e.type === "subjectTo" && e.from === id && graph.nodes[e.to]?.kind === "compliance"
    );
    if (!hasCompliance) {
      issues.push({
        code: "I10_AIFEATURE_PERSONALIZED_MISSING_COMPLIANCE",
        message: `AIFeature ${id} has personalization=${node.personalization} but no subjectTo-edge to a ComplianceClass`,
        path: ["edges"],
        nodeId: id
      });
    }
  }
  return issues;
};
