import { createHash } from "node:crypto";
import { copyFileSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, statSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { x as extractTar } from "tar";
import type { Pool } from "pg";
import { parseManifest } from "./manifest.js";
import { logger } from "../logger.js";
import {
  offlineImportRuns,
  withSpan
} from "../observability.js";

export interface ImportArchiveInput {
  pool: Pool;
  archivePath: string;
  databaseUrl: string;
  force?: boolean;
}

export interface ImportArchiveSummary {
  projectId: string;
  eventsInserted: number;
  snapshotsInserted: number;
  archivesRestored: number;
}

export async function importArchive(input: ImportArchiveInput): Promise<ImportArchiveSummary> {
  return withSpan("atlas.offline.import", { "atlas.archive_path": input.archivePath }, async () => {
    try {
      const result = await runImport(input);
      offlineImportRuns.inc({ result: "ok" });
      return result;
    } catch (error) {
      offlineImportRuns.inc({ result: "error" });
      logger.error("offline.import failed", { error: (error as Error).message });
      throw error;
    }
  });
}

async function runImport(input: ImportArchiveInput): Promise<ImportArchiveSummary> {
  const { pool, archivePath, force } = input;
  if (!statSync(archivePath).isFile()) {
    throw new Error(`importArchive: not a file: ${archivePath}`);
  }
  const stage = mkdtempSync(join(tmpdir(), "atlas-import-stage-"));
  try {
    await extractTar({ file: archivePath, cwd: stage });
    const manifest = parseManifest(JSON.parse(readFileSync(join(stage, "manifest.json"), "utf8")));

    for (const entry of [...manifest.tocoEntries, ...manifest.archives]) {
      const buf = readFileSync(join(stage, entry.name));
      const sum = createHash("sha256").update(buf).digest("hex");
      if (sum !== entry.sha256) {
        throw new Error(`importArchive: sha256 mismatch for ${entry.name}`);
      }
      if (buf.byteLength !== entry.bytes) {
        throw new Error(`importArchive: byte length mismatch for ${entry.name}`);
      }
    }

    const projectId = manifest.projectId;
    const client = await pool.connect();
    try {
      await client.query("BEGIN");
      await client.query("SELECT set_config('app.project_id', $1, true)", [projectId]);

      const { rowCount: exists } = await client.query(
        "SELECT 1 FROM spec_graphs WHERE project_id = $1",
        [projectId]
      );
      if (exists && exists > 0) {
        if (!force) {
          throw new Error(`importArchive: project ${projectId} already exists; pass force=true to overwrite`);
        }
        await client.query("DELETE FROM spec_events WHERE project_id = $1", [projectId]);
        await client.query("DELETE FROM spec_snapshots WHERE project_id = $1", [projectId]);
        await client.query("DELETE FROM spec_graphs WHERE project_id = $1", [projectId]);
      }

      const graph = JSON.parse(readFileSync(join(stage, "spec_graph.json"), "utf8"));
      await client.query(
        `INSERT INTO spec_graphs (id, project_id, schema_version, graph_data, current_event_seq, created_at, updated_at)
         VALUES ($1, $2, $3, $4::jsonb, $5, $6, $7)`,
        [
          graph.id,
          graph.projectId,
          graph.schemaVersion,
          JSON.stringify(graph.graphData),
          graph.currentEventSeq.toString(),
          graph.createdAt,
          graph.updatedAt
        ]
      );

      const eventsText = readFileSync(join(stage, "events.jsonl"), "utf8");
      const eventLines = eventsText.split("\n").filter(Boolean);
      let eventsInserted = 0;
      for (const line of eventLines) {
        const row = JSON.parse(line);
        await client.query(
          `INSERT INTO spec_events (id, project_id, event_type, payload, actor, created_at)
           VALUES ($1, $2, $3, $4::jsonb, $5, $6)`,
          [row.id, row.project_id, row.event_type, JSON.stringify(row.payload), row.actor, row.created_at]
        );
        eventsInserted++;
      }

      const snapText = readFileSync(join(stage, "snapshots.jsonl"), "utf8");
      const snapLines = snapText.split("\n").filter(Boolean);
      let snapshotsInserted = 0;
      for (const line of snapLines) {
        const row = JSON.parse(line);
        await client.query(
          `INSERT INTO spec_snapshots (id, project_id, up_to_event_id, graph_data, reason, created_at)
           VALUES ($1, $2, $3, $4::jsonb, $5, $6)`,
          [row.id, row.project_id, row.up_to_event_id, JSON.stringify(row.graph_data), row.reason, row.created_at]
        );
        snapshotsInserted++;
      }

      const archivesRoot = process.env.ATLAS_COLD_STORAGE_DIR ?? "./atlas-cold-storage";
      let archivesRestored = 0;
      const archiveStage = join(stage, "archives");
      if (readdirSyncSafe(archiveStage).length > 0) {
        mkdirSync(join(archivesRoot, projectId), { recursive: true });
        for (const f of readdirSyncSafe(archiveStage)) {
          copyFileSync(join(archiveStage, f), join(archivesRoot, projectId, f));
          archivesRestored++;
        }
      }

      await client.query(
        "SELECT setval(pg_get_serial_sequence('spec_events', 'id'), COALESCE((SELECT MAX(id) FROM spec_events), 0) + 1, false)"
      );

      await client.query("COMMIT");
      return { projectId, eventsInserted, snapshotsInserted, archivesRestored };
    } catch (error) {
      await client.query("ROLLBACK").catch(() => {});
      throw error;
    } finally {
      client.release();
    }
  } finally {
    rmSync(stage, { recursive: true, force: true });
  }
}

function readdirSyncSafe(dir: string): string[] {
  try {
    return readdirSync(dir);
  } catch {
    return [];
  }
}
