import { mkdtempSync, mkdirSync, rmSync, writeFileSync, appendFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { randomUUID } from "node:crypto";
import type { Database } from "@atlas/spec-graph-data";
import { SpecGraphRepo } from "@atlas/spec-graph-data";

export interface ProjectFixture {
  projectId: string;
  projectDir: string;
  atlasDir: string;
  graphPath: string;
  eventsPath: string;
  cleanup: () => void;
}

export function createProjectFixture(): ProjectFixture {
  const projectDir = mkdtempSync(join(tmpdir(), "atlas-sync-"));
  const atlasDir = join(projectDir, ".atlas");
  mkdirSync(atlasDir, { recursive: true });
  const graphPath = join(atlasDir, "spec.graph.json");
  const eventsPath = join(atlasDir, "events.jsonl");
  writeFileSync(graphPath, JSON.stringify({ nodes: [], edges: [] }, null, 2));
  writeFileSync(eventsPath, "");
  return {
    projectId: randomUUID(),
    projectDir,
    atlasDir,
    graphPath,
    eventsPath,
    cleanup: () => rmSync(projectDir, { recursive: true, force: true })
  };
}

export function writeGraphFile(path: string, graph: unknown): void {
  writeFileSync(path, JSON.stringify(graph, null, 2));
}

export function appendEventLine(path: string, event: unknown): void {
  appendFileSync(path, `${JSON.stringify(event)}\n`);
}

export async function truncateAll(db: Database): Promise<void> {
  await db.pool.query("TRUNCATE spec_graphs, spec_events, spec_snapshots RESTART IDENTITY CASCADE");
}

export async function seedGraph(
  db: Database,
  projectId: string,
  graphData: unknown = {}
): Promise<void> {
  const repo = new SpecGraphRepo(db.pool);
  await repo.create(projectId, graphData);
}

export function waitFor(
  predicate: () => boolean | Promise<boolean>,
  opts: { timeoutMs?: number; intervalMs?: number } = {}
): Promise<void> {
  const timeoutMs = opts.timeoutMs ?? 2_000;
  const intervalMs = opts.intervalMs ?? 20;
  return new Promise((resolve, reject) => {
    const start = Date.now();
    const tick = async () => {
      try {
        const ok = await predicate();
        if (ok) return resolve();
      } catch (err) {
        return reject(err);
      }
      if (Date.now() - start > timeoutMs) return reject(new Error("waitFor timed out"));
      setTimeout(tick, intervalMs);
    };
    void tick();
  });
}
