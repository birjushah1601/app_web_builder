import { createHash } from "node:crypto";
import { open, rename, unlink } from "node:fs/promises";
import type { SpecGraphRepo } from "@atlas/spec-graph-data";
import type { WriteTokenRegistry } from "./write-token.js";

export interface WriteGraphArgs {
  projectId: string;
  graphPath: string;
  graphRepo: SpecGraphRepo;
  tokens: WriteTokenRegistry;
}

/**
 * Reads the authoritative mirror state for `projectId` and writes it to
 * `graphPath` atomically: write a `.tmp` sibling, fsync it, rename over
 * the target. Registers the output's SHA-256 hash in the write-token
 * registry so the resulting filesystem event will be filtered out.
 */
export async function writeGraphFromMirror(args: WriteGraphArgs): Promise<void> {
  const { projectId, graphPath, graphRepo, tokens } = args;
  const row = await graphRepo.findByProjectId(projectId);
  if (!row) {
    throw new Error(`writeGraphFromMirror: no mirror row for project ${projectId}`);
  }
  const serialized = `${JSON.stringify(row.graphData, null, 2)}\n`;
  const tmpPath = `${graphPath}.tmp`;
  const fh = await open(tmpPath, "w");
  try {
    await fh.writeFile(serialized, "utf8");
    await fh.sync();
  } finally {
    await fh.close();
  }
  try {
    await rename(tmpPath, graphPath);
  } catch (err) {
    // Best-effort cleanup so a failed rename doesn't leave a stray .tmp
    await unlink(tmpPath).catch(() => undefined);
    throw err;
  }
  const hash = createHash("sha256").update(serialized).digest("hex");
  tokens.register(graphPath, hash);
}

import { appendFile, readFile, stat } from "node:fs/promises";
import type { SpecEventRepo } from "@atlas/spec-graph-data";

export interface ReconcileEventsArgs {
  projectId: string;
  eventsPath: string;
  eventRepo: SpecEventRepo;
  tokens: WriteTokenRegistry;
}

export interface ReconcileEventsResult {
  appended: number;
  highestIdOnDisk: bigint;
}

function parseIdsFromJsonl(text: string): Set<string> {
  const ids = new Set<string>();
  for (const line of text.split("\n")) {
    const trimmed = line.trim();
    if (!trimmed) continue;
    try {
      const obj = JSON.parse(trimmed) as Record<string, unknown>;
      const id = obj["id"];
      if (typeof id === "string" || typeof id === "number") {
        ids.add(String(id));
      }
    } catch {
      // skip malformed
    }
  }
  return ids;
}

/**
 * Reads events.jsonl, extracts the set of event ids already recorded on disk,
 * queries the mirror for all events, and appends any missing ones. Run at
 * daemon startup to heal any gaps (e.g. the mirror has events from another
 * process that this checkout never saw). Also registers a write-token for
 * the resulting file content so a running watcher won't round-trip our
 * own write back into the mirror.
 */
export async function reconcileEventsJsonl(
  args: ReconcileEventsArgs
): Promise<ReconcileEventsResult> {
  const { projectId, eventsPath, eventRepo, tokens } = args;
  let existingIds: Set<string> = new Set();
  try {
    const existing = await readFile(eventsPath, "utf8");
    existingIds = parseIdsFromJsonl(existing);
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code !== "ENOENT") throw err;
  }

  const mirrorEvents = await eventRepo.listSince(projectId, 0n, { limit: 100_000 });
  const missing = mirrorEvents.filter((e) => !existingIds.has(e.id.toString()));

  let appendedText = "";
  for (const ev of missing) {
    appendedText += `${JSON.stringify({
      id: ev.id.toString(),
      eventType: ev.eventType,
      payload: ev.payload,
      actor: ev.actor,
      createdAt: ev.createdAt.toISOString()
    })}\n`;
  }
  if (appendedText.length > 0) {
    await appendFile(eventsPath, appendedText, "utf8");
    const fullContent = await readFile(eventsPath, "utf8");
    const { createHash } = await import("node:crypto");
    const hash = createHash("sha256").update(fullContent).digest("hex");
    tokens.register(eventsPath, hash);
  }

  // Ensure file exists for downstream stats / offset tracking even when empty
  try {
    await stat(eventsPath);
  } catch {
    // ignore — caller may handle missing file separately
  }

  return {
    appended: missing.length,
    highestIdOnDisk: mirrorEvents.length === 0 ? 0n : mirrorEvents[mirrorEvents.length - 1]!.id
  };
}
