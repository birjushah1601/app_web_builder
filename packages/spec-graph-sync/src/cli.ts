import { parseArgs } from "node:util";
import pg from "pg";
const { Pool } = pg;
import { SyncDaemon } from "./daemon.js";

const UUID_RE = /^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$/;

export interface CliArgs {
  projectDir: string;
  projectId: string;
  databaseUrl: string;
  debounceMs: number;
  regenerateOnStartup: boolean;
}

export function parseCliArgs(argv: string[]): CliArgs {
  const { values } = parseArgs({
    args: argv,
    options: {
      "project-dir": { type: "string" },
      "project-id": { type: "string" },
      "database-url": { type: "string" },
      "debounce-ms": { type: "string", default: "100" },
      "regenerate-on-startup": { type: "boolean", default: false }
    },
    strict: true,
    allowPositionals: false
  });
  const projectDir = values["project-dir"];
  const projectId = values["project-id"];
  const databaseUrl = values["database-url"];
  if (!projectDir) throw new Error("--project-dir is required");
  if (!projectId) throw new Error("--project-id is required");
  if (!databaseUrl) throw new Error("--database-url is required");
  if (!UUID_RE.test(projectId)) throw new Error(`--project-id must be a UUID, got "${projectId}"`);

  return {
    projectDir,
    projectId,
    databaseUrl,
    debounceMs: Number.parseInt(values["debounce-ms"] ?? "100", 10),
    regenerateOnStartup: Boolean(values["regenerate-on-startup"])
  };
}

export async function main(argv: string[] = process.argv.slice(2)): Promise<void> {
  let args: CliArgs;
  try {
    args = parseCliArgs(argv);
  } catch (err) {
    process.stderr.write(`[atlas-sync] ${(err as Error).message}\n`);
    process.exit(2);
  }

  const pool = new Pool({ connectionString: args.databaseUrl });
  const daemon = new SyncDaemon({
    projectId: args.projectId,
    projectDir: args.projectDir,
    pool,
    debounceMs: args.debounceMs
  });

  let shuttingDown = false;
  const shutdown = async (signal: NodeJS.Signals) => {
    if (shuttingDown) return;
    shuttingDown = true;
    process.stdout.write(`[atlas-sync] received ${signal}, stopping...\n`);
    try {
      await daemon.stop();
      await pool.end();
      process.exit(0);
    } catch (err) {
      process.stderr.write(`[atlas-sync] shutdown error: ${(err as Error).message}\n`);
      process.exit(1);
    }
  };
  process.on("SIGINT", () => void shutdown("SIGINT"));
  process.on("SIGTERM", () => void shutdown("SIGTERM"));

  try {
    await daemon.start({ regenerateOnStartup: args.regenerateOnStartup });
  } catch (err) {
    process.stderr.write(`[atlas-sync] startup error: ${(err as Error).message}\n`);
    process.exit(1);
  }
}
