import { readdir, readFile } from "node:fs/promises";
import { join } from "node:path";
import type { Pool } from "pg";
import { BranchOperationError } from "./errors.js";

export interface ReplayInput {
  pool: Pool;
  schemaName: string;
  migrationsDir: string;
}

export interface ReplayResult {
  schemaName: string;
  applied: number;
  filenames: string[];
}

export async function replayMigrationsToSchema(input: ReplayInput): Promise<ReplayResult> {
  const { pool, schemaName, migrationsDir } = input;
  const entries = await readdir(migrationsDir);
  const sqlFiles = entries.filter((e) => /^\d{4}_.*\.sql$/.test(e)).sort();
  const client = await pool.connect();
  try {
    await client.query(`SET search_path TO "${schemaName}"`);
    for (const file of sqlFiles) {
      const sql = await readFile(join(migrationsDir, file), "utf8");
      const stmts = sql
        .split("--> statement-breakpoint")
        .map((s) => s.trim())
        .filter(Boolean);
      for (const stmt of stmts) {
        try {
          await client.query(stmt);
        } catch (err) {
          throw new BranchOperationError(`replay failed on ${file}`, { cause: err });
        }
      }
    }
    return { schemaName, applied: sqlFiles.length, filenames: sqlFiles };
  } finally {
    client.release();
  }
}
