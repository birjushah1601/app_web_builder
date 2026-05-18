import type { SpecGraph } from "../graph.js";
import type { Invariant, ValidationIssue } from "./runner.js";

const ACTIONS = ["select", "insert", "update", "delete"] as const;

export const i05PiiModelNeedsRls: Invariant = (graph: SpecGraph): ValidationIssue[] => {
  const issues: ValidationIssue[] = [];
  for (const [id, node] of Object.entries(graph.nodes)) {
    if (node.kind !== "model" || node.piiClassification === "none") continue;
    const missing = ACTIONS.filter((a) => {
      const policy = node.rlsPolicies?.[a];
      return typeof policy !== "string" || policy.length === 0;
    });
    if (missing.length > 0) {
      issues.push({
        code: "I05_PII_MODEL_MISSING_RLS",
        message: `Model ${id} has PII but is missing RLS policies for: ${missing.join(", ")}`,
        path: ["nodes", id, "rlsPolicies"],
        nodeId: id
      });
    }
  }
  return issues;
};
