import type { SpecGraph } from "../graph.js";
import type { Invariant, ValidationIssue } from "./runner.js";
import { MEDIA_KINDS_V1 } from "../nodes/media-asset.js";

export const i14MediaAssetKindAllowlistV1: Invariant = (graph: SpecGraph): ValidationIssue[] => {
  const issues: ValidationIssue[] = [];
  const allow = new Set<string>(MEDIA_KINDS_V1);
  for (const [id, node] of Object.entries(graph.nodes)) {
    if (node.kind !== "mediaasset") continue;
    if (!allow.has(node.mediaKind)) {
      issues.push({
        code: "I14_MEDIAASSET_KIND_PHASE_B",
        message: `MediaAsset ${id} has mediaKind="${node.mediaKind}" which is deferred to Phase B; v1 allows ${[...allow].join(", ")}`,
        path: ["nodes", id, "mediaKind"],
        nodeId: id
      });
    }
  }
  return issues;
};
