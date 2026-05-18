import type { SpecGraph } from "../graph.js";
import type { Invariant, ValidationIssue } from "./runner.js";

export const i15WorkloadTopologyReferences: Invariant = (graph: SpecGraph): ValidationIssue[] => {
  const issues: ValidationIssue[] = [];
  for (const [id, node] of Object.entries(graph.nodes)) {
    if (node.kind !== "workloadtopology") continue;
    for (const ref of node.providerRefs) {
      const target = graph.nodes[ref];
      if (!target || target.kind !== "provider") {
        issues.push({
          code: "I15_WORKLOAD_TOPOLOGY_REFERENCES_INVALID",
          message: `WorkloadTopology ${id} references missing provider "${ref}"`,
          path: ["nodes", id, "providerRefs"],
          nodeId: id
        });
      }
    }
    for (const ref of node.regionRefs) {
      const target = graph.nodes[ref];
      if (!target || target.kind !== "region") {
        issues.push({
          code: "I15_WORKLOAD_TOPOLOGY_REFERENCES_INVALID",
          message: `WorkloadTopology ${id} references missing region "${ref}"`,
          path: ["nodes", id, "regionRefs"],
          nodeId: id
        });
      }
    }
  }
  return issues;
};
