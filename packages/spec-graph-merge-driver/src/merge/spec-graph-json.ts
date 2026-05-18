interface GraphDoc {
  schemaVersion?: number;
  nodes?: Array<{ id: string } & Record<string, unknown>>;
  edges?: Array<{ id: string } & Record<string, unknown>>;
  metadata?: Record<string, unknown>;
  [k: string]: unknown;
}

function parse(content: string): GraphDoc {
  if (content.trim() === "") return { schemaVersion: 1, nodes: [], edges: [], metadata: {} };
  return JSON.parse(content) as GraphDoc;
}

function unionById(
  ours: Array<{ id: string } & Record<string, unknown>> = [],
  theirs: Array<{ id: string } & Record<string, unknown>> = []
): Array<{ id: string } & Record<string, unknown>> {
  const map = new Map<string, { id: string } & Record<string, unknown>>();
  for (const item of ours) map.set(item.id, { ...item });
  for (const item of theirs) map.set(item.id, { ...(map.get(item.id) ?? {}), ...item });
  return [...map.values()].sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));
}

function mergeScalars(
  base: unknown,
  ours: unknown,
  theirs: unknown
): { value: unknown; conflict: boolean } {
  if (JSON.stringify(ours) === JSON.stringify(theirs)) {
    return { value: ours, conflict: false };
  }
  if (JSON.stringify(base) === JSON.stringify(ours)) {
    return { value: theirs, conflict: false };
  }
  if (JSON.stringify(base) === JSON.stringify(theirs)) {
    return { value: ours, conflict: false };
  }
  return { value: theirs, conflict: true };
}

function mergeMetadata(
  base: Record<string, unknown> = {},
  ours: Record<string, unknown> = {},
  theirs: Record<string, unknown> = {}
): { value: Record<string, unknown>; conflict: boolean } {
  const keys = new Set([...Object.keys(base), ...Object.keys(ours), ...Object.keys(theirs)]);
  const out: Record<string, unknown> = {};
  let conflict = false;
  for (const key of keys) {
    const { value, conflict: c } = mergeScalars(base[key], ours[key], theirs[key]);
    if (typeof value !== "undefined") out[key] = value;
    conflict ||= c;
  }
  return { value: out, conflict };
}

export function mergeSpecGraphJsonFallback(base: string, ours: string, theirs: string): string {
  const b = parse(base);
  const o = parse(ours);
  const t = parse(theirs);

  const nodes = unionById(o.nodes, t.nodes);
  const edges = unionById(o.edges, t.edges);

  const scalarResult = mergeScalars(b.schemaVersion, o.schemaVersion, t.schemaVersion);
  const metadata = mergeMetadata(b.metadata, o.metadata, t.metadata);

  const hasConflict = scalarResult.conflict || metadata.conflict;

  const merged: Record<string, unknown> = hasConflict
    ? {
        __atlas_merge_note__:
          "fallback merger: scalar conflicts resolved as theirs-wins; review required",
        schemaVersion: scalarResult.value,
        nodes,
        edges,
        metadata: metadata.value
      }
    : {
        schemaVersion: scalarResult.value,
        nodes,
        edges,
        metadata: metadata.value
      };

  return JSON.stringify(merged, null, 2) + "\n";
}

import { SpecGraphRepo, createDatabase } from "@atlas/spec-graph-data";
import { mirrorUnreachable } from "../observability.js";
import { createLogger } from "../logger.js";

const MIRROR_TIMEOUT_MS = 2_000;

function extractProjectId(...contents: string[]): string | undefined {
  for (const content of contents) {
    if (content.trim() === "") continue;
    try {
      const parsed = JSON.parse(content) as GraphDoc;
      const pid = parsed?.metadata?.["projectId"];
      if (typeof pid === "string" && pid.length > 0) return pid;
    } catch {
      // ignore; next candidate
    }
  }
  return undefined;
}

async function withDeadline<T>(promise: Promise<T>, ms: number, label: string): Promise<T> {
  let timer: NodeJS.Timeout | undefined;
  try {
    return await Promise.race([
      promise,
      new Promise<T>((_, reject) => {
        timer = setTimeout(() => reject(new Error(`${label} timed out after ${ms}ms`)), ms);
      })
    ]);
  } finally {
    if (timer) clearTimeout(timer);
  }
}

export interface MirrorFirstOptions {
  databaseUrl: string | undefined;
}

export async function mergeSpecGraphJsonMirrorFirst(
  base: string,
  ours: string,
  theirs: string,
  opts: MirrorFirstOptions
): Promise<string> {
  const log = createLogger();
  const { databaseUrl } = opts;
  if (!databaseUrl) {
    log.info("mirror-first: ATLAS_DATABASE_URL unset; using fallback merger");
    mirrorUnreachable.inc();
    return mergeSpecGraphJsonFallback(base, ours, theirs);
  }

  const projectId = extractProjectId(base, ours, theirs);
  if (!projectId) {
    log.warn("mirror-first: no projectId in metadata of any file; using fallback merger");
    return mergeSpecGraphJsonFallback(base, ours, theirs);
  }

  let db: ReturnType<typeof createDatabase> | null = null;
  try {
    db = createDatabase(databaseUrl, { connectionTimeoutMillis: MIRROR_TIMEOUT_MS });
    const repo = new SpecGraphRepo(db.pool);
    const row = await withDeadline(repo.findByProjectId(projectId), MIRROR_TIMEOUT_MS, "mirror lookup");
    if (!row) {
      log.warn("mirror-first: no row in mirror for projectId; using fallback merger", { projectId });
      return mergeSpecGraphJsonFallback(base, ours, theirs);
    }
    return JSON.stringify(row.graphData, null, 2) + "\n";
  } catch (error) {
    log.warn("mirror-first: mirror unreachable; using fallback merger", {
      err: (error as Error).message
    });
    mirrorUnreachable.inc();
    return mergeSpecGraphJsonFallback(base, ours, theirs);
  } finally {
    await db?.pool.end().catch(() => {
      /* swallow */
    });
  }
}
