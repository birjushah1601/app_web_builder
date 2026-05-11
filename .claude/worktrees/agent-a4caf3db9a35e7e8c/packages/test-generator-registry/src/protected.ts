import type { SpecGraph } from "@atlas/spec-graph-schema";

type Node = SpecGraph["nodes"][string];
export type ProtectedKind = "authboundary" | "pii-model" | "compliance";

export function protectedKindOf(node: Node): ProtectedKind | null {
  if (node.kind === "authboundary") return "authboundary";
  if (node.kind === "model" && node.piiClassification !== "none") return "pii-model";
  if (node.kind === "compliance" && node.name !== "baseline") return "compliance";
  return null;
}

export function isProtectedTarget(node: Node): boolean {
  return protectedKindOf(node) !== null;
}
