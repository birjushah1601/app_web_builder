import type { SpecGraph } from "../graph.js";
import type { Invariant, ValidationIssue } from "./runner.js";

export const i12PiiClientStateNeedsCompliance: Invariant = (graph: SpecGraph): ValidationIssue[] => {
  const issues: ValidationIssue[] = [];
  for (const [id, node] of Object.entries(graph.nodes)) {
    if (node.kind !== "clientstate") continue;
    if (node.piiClassification === "none") continue;
    const hasCompliance = graph.edges.some(
      (e) => e.type === "subjectTo" && e.from === id && graph.nodes[e.to]?.kind === "compliance"
    );
    if (!hasCompliance) {
      issues.push({
        code: "I12_PII_CLIENTSTATE_MISSING_COMPLIANCE",
        message: `ClientState ${id} carries PII (${node.piiClassification}) but has no subjectTo-edge to a ComplianceClass`,
        path: ["edges"],
        nodeId: id
      });
    }
  }
  return issues;
};
