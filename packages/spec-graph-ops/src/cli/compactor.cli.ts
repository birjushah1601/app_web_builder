import { Command } from "commander";
import { createDatabase } from "@atlas/spec-graph-data";
import { compactProject } from "../compaction/compactor.js";
import { coldStorageFromEnv } from "../compaction/cold-storage.js";
import { logger } from "../logger.js";

function tailLengthFromEnv(): number {
  const raw = process.env.ATLAS_EVENT_TAIL_LENGTH;
  const parsed = raw ? Number.parseInt(raw, 10) : 1000;
  if (!Number.isFinite(parsed) || parsed <= 0) return 1000;
  return parsed;
}

/**
 * List all project IDs across tenants.
 *
 * Calls the `list_all_project_ids()` SECURITY DEFINER function (owned by a
 * superuser, granted EXECUTE to atlas). This is the only supported way to
 * enumerate projects under FORCE ROW LEVEL SECURITY with the NOBYPASSRLS
 * atlas role. The function must be installed once by a superuser; the test
 * globalSetup (setup.ts) creates it automatically, and production deployments
 * should apply the corresponding admin migration.
 */
async function listAllProjectIds(pool: import("pg").Pool): Promise<string[]> {
  const { rows } = await pool.query<{ project_id: string }>(
    "SELECT project_id FROM list_all_project_ids()"
  );
  return rows.map((r) => r.project_id);
}

async function runOnce(projectIds: string[]): Promise<void> {
  const db = createDatabase(process.env.DATABASE_URL!);
  const storage = coldStorageFromEnv();
  const tailLength = tailLengthFromEnv();
  try {
    for (const projectId of projectIds) {
      const result = await compactProject({ pool: db.pool, projectId, tailLength, storage });
      // Serialize result safely: upToEventId is a BigInt which JSON.stringify cannot handle.
      const safeResult =
        result.status === "ok"
          ? { ...result, upToEventId: result.upToEventId.toString() }
          : result;
      logger.info("compactor.run", { projectId, result: safeResult });
    }
  } finally {
    await db.pool.end();
  }
}

export async function main(argv: string[]): Promise<void> {
  const program = new Command();
  program.name("atlas-compactor").description("Spec Graph compaction tool");

  program
    .command("run")
    .description("Run compaction once and exit")
    .option("--project-id <uuid>", "compact a single project")
    .option("--all", "compact every project")
    .action(async (opts: { projectId?: string; all?: boolean }) => {
      const db = createDatabase(process.env.DATABASE_URL!);
      try {
        const ids = opts.all ? await listAllProjectIds(db.pool) : opts.projectId ? [opts.projectId] : [];
        if (ids.length === 0) {
          throw new Error("atlas-compactor run: pass --project-id <uuid> or --all");
        }
        await db.pool.end();
        await runOnce(ids);
      } catch (error) {
        await db.pool.end().catch(() => {});
        throw error;
      }
    });

  program
    .command("daemon")
    .description("Run compaction in a loop with a configurable interval")
    .option("--interval-ms <ms>", "interval between passes", "3600000")
    .action(async (opts: { intervalMs: string }) => {
      const intervalMs = Number.parseInt(opts.intervalMs, 10);
      let stopped = false;
      const stop = () => { stopped = true; };
      process.on("SIGINT", stop);
      process.on("SIGTERM", stop);

      logger.info("compactor.daemon.start", { intervalMs });
      while (!stopped) {
        const db = createDatabase(process.env.DATABASE_URL!);
        try {
          const ids = await listAllProjectIds(db.pool);
          await db.pool.end();
          await runOnce(ids);
        } catch (error) {
          await db.pool.end().catch(() => {});
          logger.error("compactor.daemon.error", { error: (error as Error).message });
        }
        if (stopped) break;
        await new Promise<void>((resolve) => {
          const t = setTimeout(resolve, intervalMs);
          t.unref?.();
        });
      }
      logger.info("compactor.daemon.stop");
    });

  await program.parseAsync(argv);
}
