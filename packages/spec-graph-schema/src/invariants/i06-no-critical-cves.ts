import type { SpecGraph } from "../graph.js";
import type { Invariant, ValidationIssue } from "./runner.js";

export const i06NoCriticalCves: Invariant = (graph: SpecGraph): ValidationIssue[] => {
  const issues: ValidationIssue[] = [];
  for (const [id, node] of Object.entries(graph.nodes)) {
    if (node.kind !== "dependency") continue;
    if (node.cveScanStatus.severity === "critical") {
      issues.push({
        code: "I06_DEPENDENCY_HAS_CRITICAL_CVE",
        message: `Dependency ${node.name}@${node.version} has a critical CVE — merge-blocker until resolved`,
        path: ["nodes", id, "cveScanStatus"],
        nodeId: id
      });
    }
  }
  return issues;
};
