import type { Pool, PoolClient } from "pg";
import { logger } from "../logger.js";
import {
  compactionDuration,
  compactionEventsCompacted,
  compactionRuns,
  compactionSnapshotBytes,
  withSpan
} from "../observability.js";
import { projectLockKey, withAdvisoryLock } from "./advisory-lock.js";
import type { ColdStorage } from "./cold-storage.js";

export interface CompactProjectInput {
  pool: Pool;
  projectId: string;
  tailLength: number;
  storage: ColdStorage;
}

export type CompactProjectResult =
  | { status: "ok"; eventsCompacted: number; archiveKey: string; snapshotId: string; upToEventId: bigint }
  | { status: "skipped-no-work"; reason: "under-tail-length" | "lock-held" };

export async function compactProject(input: CompactProjectInput): Promise<CompactProjectResult> {
  const { pool, projectId, tailLength, storage } = input;
  const start = process.hrtime.bigint();
  return withSpan("atlas.compaction", { "atlas.project_id": projectId }, async () => {
    try {
      const lock = await withAdvisoryLock(pool, projectLockKey(projectId), () =>
        runCompaction(pool, projectId, tailLength, storage)
      );
      if (!lock.acquired) {
        compactionRuns.inc({ result: "skipped-no-work" });
        return { status: "skipped-no-work", reason: "lock-held" };
      }
      const result = lock.value;
      if (result.status === "skipped-no-work") {
        compactionRuns.inc({ result: "skipped-no-work" });
      } else {
        compactionRuns.inc({ result: "ok" });
        compactionEventsCompacted.inc(result.eventsCompacted);
      }
      return result;
    } catch (error) {
      compactionRuns.inc({ result: "error" });
      logger.error("compaction failed", { projectId, error: (error as Error).message });
      throw error;
    } finally {
      const durationNs = process.hrtime.bigint() - start;
      compactionDuration.observe(Number(durationNs) / 1e9);
    }
  });
}

async function runCompaction(
  pool: Pool,
  projectId: string,
  tailLength: number,
  storage: ColdStorage
): Promise<CompactProjectResult> {
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    await client.query("SELECT set_config('app.project_id', $1, true)", [projectId]);

    const cutoff = await findCutoff(client, projectId, tailLength);
    if (cutoff === null) {
      await client.query("COMMIT");
      return { status: "skipped-no-work", reason: "under-tail-length" };
    }

    const { rows: toArchive } = await client.query<{
      id: string;
      project_id: string;
      event_type: string;
      payload: unknown;
      actor: string | null;
      created_at: string;
    }>(
      `SELECT id, project_id, event_type, payload, actor, created_at
         FROM spec_events
        WHERE project_id = $1 AND id <= $2
        ORDER BY id ASC
        FOR UPDATE SKIP LOCKED`,
      [projectId, cutoff.toString()]
    );

    if (toArchive.length === 0) {
      await client.query("COMMIT");
      return { status: "skipped-no-work", reason: "under-tail-length" };
    }

    const fromEventId = BigInt(toArchive[0]!.id);
    const toEventId = BigInt(toArchive[toArchive.length - 1]!.id);

    const { rows: graphRows } = await client.query<{ graph_data: unknown }>(
      "SELECT graph_data FROM spec_graphs WHERE project_id = $1",
      [projectId]
    );
    const graphData = graphRows[0]?.graph_data ?? {};
    const snapshotPayload = JSON.stringify(graphData);
    compactionSnapshotBytes.observe(Buffer.byteLength(snapshotPayload, "utf8"));

    const { rows: insertedSnap } = await client.query<{ id: string }>(
      `INSERT INTO spec_snapshots (project_id, up_to_event_id, graph_data, reason)
       VALUES ($1, $2, $3::jsonb, 'compaction')
       RETURNING id`,
      [projectId, toEventId.toString(), snapshotPayload]
    );
    const snapshotId = insertedSnap[0]!.id;

    const jsonl = toArchive.map((r) => JSON.stringify(r)).join("\n") + "\n";
    const { key: archiveKey } = await storage.putArchive({
      projectId,
      fromEventId,
      toEventId,
      jsonl
    });

    await client.query(
      "DELETE FROM spec_events WHERE project_id = $1 AND id <= $2",
      [projectId, toEventId.toString()]
    );

    await client.query("COMMIT");
    logger.info("compaction complete", {
      projectId,
      eventsCompacted: toArchive.length,
      snapshotId,
      archiveKey
    });
    return {
      status: "ok",
      eventsCompacted: toArchive.length,
      archiveKey,
      snapshotId,
      upToEventId: toEventId
    };
  } catch (error) {
    await client.query("ROLLBACK").catch(() => {});
    throw error;
  } finally {
    client.release();
  }
}

async function findCutoff(
  client: PoolClient,
  projectId: string,
  tailLength: number
): Promise<bigint | null> {
  const { rows } = await client.query<{ id: string }>(
    `SELECT id FROM spec_events
       WHERE project_id = $1
       ORDER BY id DESC
       OFFSET $2 LIMIT 1`,
    [projectId, tailLength]
  );
  if (rows.length === 0) return null;
  return BigInt(rows[0]!.id);
}
