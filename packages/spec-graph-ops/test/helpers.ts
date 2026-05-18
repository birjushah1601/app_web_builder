import { randomUUID } from "node:crypto";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createDatabase, type Database } from "@atlas/spec-graph-data";

export function uniqueProjectId(): string {
  return randomUUID();
}

export function createTestDb(): Database {
  return createDatabase(process.env.DATABASE_URL_TEST!);
}

export async function truncateAll(db: Database): Promise<void> {
  await db.pool.query("TRUNCATE spec_graphs, spec_events, spec_snapshots RESTART IDENTITY CASCADE");
}

export function makeTempColdStorageDir(): { dir: string; cleanup: () => void } {
  const dir = mkdtempSync(join(tmpdir(), "atlas-cold-"));
  return { dir, cleanup: () => rmSync(dir, { recursive: true, force: true }) };
}
