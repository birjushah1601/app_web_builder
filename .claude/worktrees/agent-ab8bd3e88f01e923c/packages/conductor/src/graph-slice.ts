import { createHash } from "node:crypto";
import type { SpecGraph } from "@atlas/spec-graph-schema";

export interface SliceSelector {
  includeAllNodes?: boolean;
  includeAllEdges?: boolean;
  nodeIds?: string[];
  edgeKey?: (e: { from: string; to: string; type: string }) => boolean;
}

export interface SerializedSlice {
  bytes: string; // canonical JSON
  nodeIds: string[];
  edgeCount: number;
}

export function serializeSlice(graph: SpecGraph, selector: SliceSelector): SerializedSlice {
  const allNodeIds = Object.keys(graph.nodes);
  const nodeIds = selector.includeAllNodes
    ? allNodeIds.slice().sort()
    : (selector.nodeIds ?? []).slice().sort();
  const nodes: Array<Record<string, unknown>> = [];
  for (const id of nodeIds) {
    const n = (graph.nodes as Record<string, Record<string, unknown>>)[id];
    if (n) nodes.push(canonicalize(n) as Record<string, unknown>);
  }
  const edges = (graph.edges as Array<{ from: string; to: string; type: string } & Record<string, unknown>>)
    .filter((e) => selector.includeAllEdges || (selector.edgeKey ? selector.edgeKey(e) : false))
    .slice()
    .sort((a, b) => {
      if (a.from !== b.from) return a.from < b.from ? -1 : 1;
      if (a.to !== b.to) return a.to < b.to ? -1 : 1;
      if (a.type !== b.type) return a.type < b.type ? -1 : 1;
      return 0;
    })
    .map(canonicalize);
  const payload = { nodes, edges };
  const bytes = JSON.stringify(payload);
  return { bytes, nodeIds, edgeCount: edges.length };
}

export function hashSlice(graph: SpecGraph, selector: SliceSelector): string {
  const { bytes } = serializeSlice(graph, selector);
  return "sha256:" + createHash("sha256").update(bytes).digest("hex");
}

function canonicalize(value: unknown): unknown {
  if (value === null || typeof value !== "object") return value;
  if (Array.isArray(value)) return value.map(canonicalize);
  const sorted: Record<string, unknown> = {};
  for (const k of Object.keys(value as Record<string, unknown>).sort()) {
    sorted[k] = canonicalize((value as Record<string, unknown>)[k]);
  }
  return sorted;
}
