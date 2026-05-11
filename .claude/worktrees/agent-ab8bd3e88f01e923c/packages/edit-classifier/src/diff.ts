import type { SpecGraph } from "@atlas/spec-graph-schema";
import type { FieldChange } from "./types.js";

const ROOT_FIELDS = [
  "schemaVersion", "projectId", "name", "complianceClasses",
  "databaseProvider", "templateDigest"
] as const;

export function diffGraphs(before: SpecGraph, after: SpecGraph): FieldChange[] {
  const changes: FieldChange[] = [];

  // Diff root-level fields under nodeId="$root"
  for (const field of ROOT_FIELDS) {
    diffValue("$root", field, (before as never)[field], (after as never)[field], changes);
  }

  // Diff nodes by id
  const beforeNodes = (before.nodes ?? {}) as Record<string, Record<string, unknown>>;
  const afterNodes = (after.nodes ?? {}) as Record<string, Record<string, unknown>>;
  const allIds = new Set([...Object.keys(beforeNodes), ...Object.keys(afterNodes)]);
  for (const id of allIds) {
    const b = beforeNodes[id];
    const a = afterNodes[id];
    if (!b && a) {
      changes.push({ kind: "added", nodeId: id, fieldPath: "$node", newValue: a });
    } else if (b && !a) {
      changes.push({ kind: "removed", nodeId: id, fieldPath: "$node", oldValue: b });
    } else if (b && a) {
      const fields = new Set([...Object.keys(b), ...Object.keys(a)]);
      for (const f of fields) {
        diffValue(id, f, b[f], a[f], changes);
      }
    }
  }

  // Diff edges by composite key
  const edgeKey = (e: { from: string; to: string; type: string }) => `${e.from}|${e.to}|${e.type}`;
  const beforeEdges = new Map((before.edges ?? []).map((e) => [edgeKey(e as never), e]));
  const afterEdges = new Map((after.edges ?? []).map((e) => [edgeKey(e as never), e]));
  for (const [k, e] of afterEdges) {
    if (!beforeEdges.has(k)) {
      changes.push({ kind: "added", nodeId: `edge:${k}`, fieldPath: "$edge", newValue: e });
    }
  }
  for (const [k, e] of beforeEdges) {
    if (!afterEdges.has(k)) {
      changes.push({ kind: "removed", nodeId: `edge:${k}`, fieldPath: "$edge", oldValue: e });
    }
  }
  return changes;
}

function diffValue(nodeId: string, fieldPath: string, b: unknown, a: unknown, out: FieldChange[]): void {
  if (b === undefined && a !== undefined) {
    out.push({ kind: "added", nodeId, fieldPath, newValue: a });
    return;
  }
  if (b !== undefined && a === undefined) {
    out.push({ kind: "removed", nodeId, fieldPath, oldValue: b });
    return;
  }
  if (isPrimitive(b) || isPrimitive(a)) {
    if (!deepEqual(b, a)) out.push({ kind: "modified", nodeId, fieldPath, oldValue: b, newValue: a });
    return;
  }
  // Both are objects — recurse on keys
  const bo = b as Record<string, unknown>;
  const ao = a as Record<string, unknown>;
  const keys = new Set([...Object.keys(bo), ...Object.keys(ao)]);
  for (const k of keys) {
    diffValue(nodeId, `${fieldPath}.${k}`, bo[k], ao[k], out);
  }
}

function isPrimitive(v: unknown): boolean {
  return v === null || typeof v !== "object";
}

function deepEqual(a: unknown, b: unknown): boolean {
  return JSON.stringify(a) === JSON.stringify(b);
}
