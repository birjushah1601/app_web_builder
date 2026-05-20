import type { SpecGraph } from "../graph.js";
import type { Invariant, ValidationIssue } from "./runner.js";

export const i16ModelResidencyRequiresStoresDataIn: Invariant = (graph: SpecGraph): ValidationIssue[] => {
  const issues: ValidationIssue[] = [];

  const hasResidencyContext = Object.values(graph.nodes).some(
    (n) => n.kind === "region" || n.kind === "dataresidency"
  );
  if (!hasResidencyContext) return issues;

  const modelHasStoresDataIn = new Set<string>();
  for (const edge of graph.edges) {
    if (edge.type === "storesDataIn") modelHasStoresDataIn.add(edge.from);
  }

  for (const [id, node] of Object.entries(graph.nodes)) {
    if (node.kind !== "model") continue;
    if (node.piiClassification === "none") continue;
    if (modelHasStoresDataIn.has(id)) continue;
    issues.push({
      code: "I16_PII_MODEL_MISSING_STORES_DATA_IN",
      message: `PII Model ${id} must declare a storesDataIn edge to a Region or DataResidency node`,
      path: ["nodes", id],
      nodeId: id
    });
  }
  return issues;
};
