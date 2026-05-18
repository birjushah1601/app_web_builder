import type { SpecGraph } from "../graph.js";
import type { Invariant, ValidationIssue } from "./runner.js";

export const i11MediaAssetGeneratedNeedsProvider: Invariant = (graph: SpecGraph): ValidationIssue[] => {
  const issues: ValidationIssue[] = [];
  for (const [id, node] of Object.entries(graph.nodes)) {
    if (node.kind !== "mediaasset") continue;
    if (node.licenseStatus !== "generated") continue;
    if (!node.providerCapability) {
      issues.push({
        code: "I11_GENERATED_MEDIA_MISSING_PROVIDER",
        message: `MediaAsset ${id} is generated but missing providerCapability attestation`,
        path: ["nodes", id, "providerCapability"],
        nodeId: id
      });
    }
  }
  return issues;
};
