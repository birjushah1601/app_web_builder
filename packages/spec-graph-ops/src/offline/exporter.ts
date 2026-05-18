import { createHash } from "node:crypto";
import { mkdirSync, mkdtempSync, readFileSync, rmSync, statSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { create as createTar } from "tar";
import type { Pool } from "pg";
import {
  offlineExportArchiveBytes,
  offlineExportRuns,
  withSpan
} from "../observability.js";
import type { ColdStorage } from "../compaction/cold-storage.js";
import { logger } from "../logger.js";
import { MANIFEST_SCHEMA_VERSION, type Manifest } from "./manifest.js";

export interface ExportProjectInput {
  pool: Pool;
  projectId: string;
  outPath: string;
  storage: ColdStorage;
}

export interface ExportProjectResult {
  outPath: string;
  bytes: number;
}

export async function exportProject(input: ExportProjectInput): Promise<ExportProjectResult> {
  const { pool, projectId, outPath, storage } = input;
  return withSpan("atlas.offline.export", { "atlas.project_id": projectId }, async () => {
    try {
      const result = await runExport(pool, projectId, outPath, storage);
      offlineExportRuns.inc({ result: "ok" });
      offlineExportArchiveBytes.observe(result.bytes);
      return result;
    } catch (error) {
      offlineExportRuns.inc({ result: "error" });
      logger.error("offline.export failed", { projectId, error: (error as Error).message });
      throw error;
    }
  });
}

async function runExport(
  pool: Pool,
  projectId: string,
  outPath: string,
  storage: ColdStorage
): Promise<ExportProjectResult> {
  const client = await pool.connect();
  const stage = mkdtempSync(join(tmpdir(), "atlas-export-stage-"));
  try {
    await client.query("BEGIN");
    await client.query("SELECT set_config('app.project_id', $1, true)", [projectId]);

    const { rows: graphRows } = await client.query(
      `SELECT id, project_id AS "projectId", schema_version AS "schemaVersion",
              graph_data AS "graphData", current_event_seq AS "currentEventSeq",
              created_at AS "createdAt", updated_at AS "updatedAt"
         FROM spec_graphs
        WHERE project_id = $1`,
      [projectId]
    );
    if (graphRows.length === 0) {
      throw new Error(`exportProject: no spec_graphs row for project ${projectId}`);
    }

    const { rows: eventRows } = await client.query(
      `SELECT id, project_id, event_type, payload, actor, created_at
         FROM spec_events
        WHERE project_id = $1
        ORDER BY id ASC`,
      [projectId]
    );
    const { rows: snapshotRows } = await client.query(
      `SELECT id, project_id, up_to_event_id, graph_data, reason, created_at
         FROM spec_snapshots
        WHERE project_id = $1
        ORDER BY created_at ASC`,
      [projectId]
    );

    await client.query("COMMIT");

    const graphBytes = writeStage(stage, "spec_graph.json", JSON.stringify(graphRows[0], replaceBigints));
    const eventsBytes = writeStage(stage, "events.jsonl", eventRows.map((r) => JSON.stringify(r, replaceBigints)).join("\n") + "\n");
    const snapshotsBytes = writeStage(stage, "snapshots.jsonl", snapshotRows.map((r) => JSON.stringify(r, replaceBigints)).join("\n") + "\n");

    const archiveDir = join(stage, "archives");
    mkdirSync(archiveDir, { recursive: true });
    const archiveEntries: Manifest["archives"] = [];
    for (const snap of snapshotRows) {
      const upTo = BigInt(snap.up_to_event_id);
      const candidates = await discoverArchivesForProject(storage, projectId, upTo);
      for (const key of candidates) {
        const jsonl = await storage.getArchive(key);
        const name = `archives/${key.split("/").slice(1).join("/")}`;
        const bytes = writeStageRaw(stage, name, Buffer.from(jsonl, "utf8"));
        archiveEntries.push({
          name,
          sha256: sha256Hex(readStage(stage, name)),
          bytes
        });
      }
    }

    const tocoEntries = [
      { name: "spec_graph.json", sha256: sha256Hex(readStage(stage, "spec_graph.json")), bytes: graphBytes },
      { name: "events.jsonl", sha256: sha256Hex(readStage(stage, "events.jsonl")), bytes: eventsBytes },
      { name: "snapshots.jsonl", sha256: sha256Hex(readStage(stage, "snapshots.jsonl")), bytes: snapshotsBytes }
    ] as const;

    const manifest: Manifest = {
      schemaVersion: MANIFEST_SCHEMA_VERSION,
      exportedAt: new Date().toISOString(),
      projectId,
      tocoEntries: [...tocoEntries],
      archives: archiveEntries
    };
    writeStage(stage, "manifest.json", JSON.stringify(manifest, null, 2));

    const entries = ["manifest.json", "spec_graph.json", "events.jsonl", "snapshots.jsonl", "archives"];
    await createTar({ gzip: true, cwd: stage, file: outPath }, entries);

    const bytes = statSync(outPath).size;
    return { outPath, bytes };
  } catch (error) {
    await client.query("ROLLBACK").catch(() => {});
    throw error;
  } finally {
    client.release();
    rmSync(stage, { recursive: true, force: true });
  }
}

function writeStage(stage: string, name: string, contents: string): number {
  const buf = Buffer.from(contents, "utf8");
  writeFileSync(join(stage, name), buf);
  return buf.byteLength;
}

function writeStageRaw(stage: string, name: string, buf: Buffer): number {
  const full = join(stage, name);
  mkdirSync(dirname(full), { recursive: true });
  writeFileSync(full, buf);
  return buf.byteLength;
}

function readStage(stage: string, name: string): Buffer {
  return readFileSync(join(stage, name));
}

function sha256Hex(buf: Buffer): string {
  return createHash("sha256").update(buf).digest("hex");
}

function replaceBigints(_key: string, value: unknown): unknown {
  return typeof value === "bigint" ? value.toString() : value;
}

async function discoverArchivesForProject(
  _storage: ColdStorage,
  projectId: string,
  upToEventId: bigint
): Promise<string[]> {
  const fs = await import("node:fs");
  const path = await import("node:path");
  const baseDir = process.env.ATLAS_COLD_STORAGE_DIR ?? "./atlas-cold-storage";
  const projectDir = path.join(baseDir, projectId);
  if (!fs.existsSync(projectDir)) return [];
  return fs.readdirSync(projectDir)
    .filter((f) => f.endsWith(".jsonl.gz"))
    .filter((f) => {
      const to = BigInt(f.split("-")[1]!.replace(".jsonl.gz", ""));
      return to <= upToEventId;
    })
    .map((f) => `${projectId}/${f}`);
}
