import { createHash } from "node:crypto";
import { open, readFile } from "node:fs/promises";
import type { SpecEventRepo, SpecGraphRepo } from "@atlas/spec-graph-data";

export interface FileToMirrorState {
  /** Byte offset into events.jsonl up to which we've already ingested. */
  eventsFileOffset: number;
}

export interface IngestEventLinesArgs {
  projectId: string;
  eventsPath: string;
  state: FileToMirrorState;
  eventRepo: SpecEventRepo;
}

export interface IngestEventLinesResult {
  appended: number;
  invalid: number;
}

interface ParsedEvent {
  eventType: string;
  payload: unknown;
  actor: string | null;
}

function parseLine(line: string): ParsedEvent | null {
  try {
    const raw = JSON.parse(line) as Record<string, unknown>;
    const eventType = raw["eventType"];
    const payload = raw["payload"];
    if (typeof eventType !== "string" || payload === undefined) return null;
    const actor = raw["actor"];
    return {
      eventType,
      payload,
      actor: typeof actor === "string" ? actor : null
    };
  } catch {
    return null;
  }
}

/**
 * Reads new bytes appended to events.jsonl since the last recorded offset,
 * parses each complete line as a spec event, and appends each one to the
 * mirror via `SpecEventRepo.append`. Malformed or incomplete lines are
 * skipped and counted. The offset advances only past *complete* lines —
 * a trailing partial line (no newline) is left for the next invocation.
 */
export async function ingestNewEventLines(
  args: IngestEventLinesArgs
): Promise<IngestEventLinesResult> {
  const { projectId, eventsPath, state, eventRepo } = args;
  const fh = await open(eventsPath, "r");
  try {
    const stats = await fh.stat();
    if (stats.size <= state.eventsFileOffset) {
      return { appended: 0, invalid: 0 };
    }
    const bytesToRead = stats.size - state.eventsFileOffset;
    const buffer = Buffer.alloc(bytesToRead);
    await fh.read(buffer, 0, bytesToRead, state.eventsFileOffset);
    const text = buffer.toString("utf8");

    const lastNewline = text.lastIndexOf("\n");
    if (lastNewline === -1) {
      // Entire read is a partial line. Do not advance offset.
      return { appended: 0, invalid: 0 };
    }
    const completeSection = text.slice(0, lastNewline);
    const completeBytes = Buffer.byteLength(completeSection, "utf8") + 1; // +1 for the \n

    const lines = completeSection.split("\n");
    let appended = 0;
    let invalid = 0;
    for (const line of lines) {
      if (line.trim() === "") continue;
      const parsed = parseLine(line);
      if (!parsed) {
        invalid += 1;
        continue;
      }
      await eventRepo.append(projectId, parsed);
      appended += 1;
    }

    state.eventsFileOffset += completeBytes;
    return { appended, invalid };
  } finally {
    await fh.close();
  }
}

export interface SyncGraphFileArgs {
  projectId: string;
  graphPath: string;
  graphRepo: SpecGraphRepo;
  eventRepo: SpecEventRepo;
}

export interface SyncGraphFileResult {
  updated: boolean;
}

export function sha256(data: string | Buffer): string {
  return createHash("sha256").update(data).digest("hex");
}

/**
 * Stable JSON stringify with sorted keys. Postgres JSONB does not preserve
 * key insertion order (it stores values canonically), so a raw
 * `JSON.stringify` round-trip through the mirror can reshuffle key order
 * and spuriously report drift. Canonicalise before hashing.
 */
export function canonicalJson(value: unknown): string {
  if (value === null || typeof value !== "object") {
    return JSON.stringify(value);
  }
  if (Array.isArray(value)) {
    return `[${value.map(canonicalJson).join(",")}]`;
  }
  const entries = Object.entries(value as Record<string, unknown>).sort(([a], [b]) =>
    a < b ? -1 : a > b ? 1 : 0
  );
  return `{${entries.map(([k, v]) => `${JSON.stringify(k)}:${canonicalJson(v)}`).join(",")}}`;
}

/**
 * Reads spec.graph.json, compares against the mirror's graph_data. If they
 * differ, appends a `graph.file_edited` event and overwrites mirror state
 * with the file contents (mirror then stamps current_event_seq with the
 * new event's id). No-op when file and mirror already match.
 *
 * Throws a `reconciliation-needed: ...` error if the project has no mirror
 * row; the daemon handler surfaces this as a reconciliation counter bump.
 */
export async function syncGraphFileToMirror(args: SyncGraphFileArgs): Promise<SyncGraphFileResult> {
  const { projectId, graphPath, graphRepo, eventRepo } = args;
  const raw = await readFile(graphPath, "utf8");
  const fileGraph = JSON.parse(raw) as unknown;
  const fileHash = sha256(canonicalJson(fileGraph));

  const mirror = await graphRepo.findByProjectId(projectId);
  if (!mirror) {
    throw new Error(
      `reconciliation-needed: project ${projectId} has a spec.graph.json on disk but no mirror row. ` +
        `Create the project via SpecGraphRepo.create before starting the sync daemon.`
    );
  }

  const mirrorHash = sha256(canonicalJson(mirror.graphData));
  if (mirrorHash === fileHash) {
    return { updated: false };
  }

  const event = await eventRepo.append(projectId, {
    eventType: "graph.file_edited",
    payload: { fileHash, mirrorHashBefore: mirrorHash },
    actor: "sync-daemon"
  });
  await graphRepo.updateGraphData(projectId, fileGraph, event.id);
  return { updated: true };
}
