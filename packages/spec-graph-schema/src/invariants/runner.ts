import type { SpecGraph } from "../graph.js";

export interface ValidationIssue {
  code: string;
  message: string;
  path: Array<string | number>;
  nodeId?: string;
  edgeIndex?: number;
}

export interface ValidationResult {
  ok: boolean;
  issues: ValidationIssue[];
}

export type Invariant = (graph: SpecGraph) => ValidationIssue[];

export function runInvariants(graph: SpecGraph, invariants: Invariant[]): ValidationResult {
  const issues: ValidationIssue[] = [];
  for (const invariant of invariants) {
    issues.push(...invariant(graph));
  }
  return { ok: issues.length === 0, issues };
}
