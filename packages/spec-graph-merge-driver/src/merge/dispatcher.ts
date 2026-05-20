import { mergeEventsJsonl } from "./events-jsonl.js";
import { mergeSpecGraphJsonMirrorFirst } from "./spec-graph-json.js";

export class UnknownPatternError extends Error {
  readonly pathname: string;
  constructor(pathname: string) {
    super(`atlas-merge-driver: no merger registered for path "${pathname}"`);
    this.name = "UnknownPatternError";
    this.pathname = pathname;
  }
}

function normalize(pathname: string): string {
  return pathname.replace(/\\/g, "/");
}

export interface DispatchInput {
  pathname: string;
  base: string;
  ours: string;
  theirs: string;
  databaseUrl: string | undefined;
}

export async function dispatchMerge(input: DispatchInput): Promise<string> {
  const norm = normalize(input.pathname);
  if (norm.endsWith(".atlas/events.jsonl")) {
    return mergeEventsJsonl(input.base, input.ours, input.theirs);
  }
  if (norm.endsWith(".atlas/spec.graph.json")) {
    return mergeSpecGraphJsonMirrorFirst(input.base, input.ours, input.theirs, {
      databaseUrl: input.databaseUrl
    });
  }
  throw new UnknownPatternError(input.pathname);
}

export function patternFor(pathname: string): "events.jsonl" | "spec.graph.json" | "unknown" {
  const norm = normalize(pathname);
  if (norm.endsWith(".atlas/events.jsonl")) return "events.jsonl";
  if (norm.endsWith(".atlas/spec.graph.json")) return "spec.graph.json";
  return "unknown";
}
