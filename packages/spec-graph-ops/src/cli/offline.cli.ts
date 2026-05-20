import { Command } from "commander";
import { createDatabase } from "@atlas/spec-graph-data";
import { exportProject } from "../offline/exporter.js";
import { importArchive } from "../offline/importer.js";
import { coldStorageFromEnv } from "../compaction/cold-storage.js";
import { logger } from "../logger.js";

export async function main(argv: string[]): Promise<void> {
  const program = new Command();
  program.name("atlas-offline").description("Export/import Atlas projects for offline/local use");

  program
    .command("export")
    .description("Export a project to a .tar.gz archive")
    .requiredOption("--project-id <uuid>", "project to export")
    .requiredOption("--out <path.tar.gz>", "output archive path")
    .action(async (opts: { projectId: string; out: string }) => {
      const db = createDatabase(process.env.DATABASE_URL!);
      try {
        const result = await exportProject({
          pool: db.pool,
          projectId: opts.projectId,
          outPath: opts.out,
          storage: coldStorageFromEnv()
        });
        logger.info("offline.export.ok", { ...result });
      } finally {
        await db.pool.end();
      }
    });

  program
    .command("import")
    .description("Import a .tar.gz archive into a Postgres database")
    .requiredOption("--archive <path.tar.gz>", "input archive path")
    .requiredOption("--database-url <url>", "target Postgres URL")
    .option("--force", "overwrite an existing project", false)
    .action(async (opts: { archive: string; databaseUrl: string; force: boolean }) => {
      const db = createDatabase(opts.databaseUrl);
      try {
        const summary = await importArchive({
          pool: db.pool,
          archivePath: opts.archive,
          databaseUrl: opts.databaseUrl,
          force: opts.force
        });
        logger.info("offline.import.ok", { ...summary });
      } finally {
        await db.pool.end();
      }
    });

  await program.parseAsync(argv);
}
