import { open } from "node:fs/promises";
import type { SpecEventRepo } from "@atlas/spec-graph-data";

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
