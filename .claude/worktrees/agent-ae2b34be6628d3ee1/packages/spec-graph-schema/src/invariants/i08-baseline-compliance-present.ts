import type { SpecGraph } from "../graph.js";
import type { Invariant, ValidationIssue } from "./runner.js";

export const i08BaselineCompliancePresent: Invariant = (graph: SpecGraph): ValidationIssue[] => {
  const baselines = Object.values(graph.nodes).filter((n) => n.kind === "compliance" && n.name === "baseline");
  if (baselines.length === 1) return [];
  return [{
    code: baselines.length === 0 ? "I08_BASELINE_COMPLIANCE_MISSING" : "I08_BASELINE_COMPLIANCE_DUPLICATED",
    message: `Exactly one ComplianceClass with name="baseline" must be present (found ${baselines.length})`,
    path: ["nodes"]
  }];
};
