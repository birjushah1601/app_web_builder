// packages/eval-runtime/src/cli/build-dataset.ts
import { mkdir, writeFile } from "node:fs/promises";
import { existsSync } from "node:fs";
import { join } from "node:path";
import { randomUUID } from "node:crypto";
import pg, { type Pool } from "pg";
import { EvalVerdictRepo } from "@atlas/spec-graph-data";
import type { EvalCase } from "../types.js";

/**
 * Build a set of EvalCase JSON files from `eval_verdicts` rows in the DB.
 *
 * NOTE: The `output` field in the generated case is left as `{}` (opaque)
 * because the full output blob is NOT stored in eval_verdicts — only its hash
 * is persisted. v1 acceptable; future work should store blobs or a retrieval key.
 */
export async function buildDataset(args: string[]): Promise<void> {
  const roleArg = parseArg(args, "--role");
  const limit = parseInt(parseArg(args, "--limit") ?? "100", 10);
  const casesDir =
    parseArg(args, "--cases-dir") ??
    join(process.cwd(), "packages/eval-runtime/cases");
  const databaseUrl =
    process.env["DATABASE_URL"] ??
    "postgres://atlas:atlas@localhost:5440/atlas_dev";

  if (!roleArg) {
    console.error(
      "Usage: evals build-dataset --role <roleId> [--limit N] [--cases-dir path]"
    );
    process.exit(1);
  }

  const pool = new pg.Pool({ connectionString: databaseUrl });
  try {
    const repo = new EvalVerdictRepo(pool);
    const rows = await repo.findFailuresForRole(roleArg, limit);

    // Dedup by (prior_artifact_hash, output_hash) — same input+output pair
    // appearing in multiple rituals produces only one case file.
    const seen = new Set<string>();
    let written = 0;

    for (const row of rows) {
      if (!row.priorArtifactHash || !row.outputHash) continue;
      const key = `${row.priorArtifactHash}:${row.outputHash}`;
      if (seen.has(key)) continue;
      seen.add(key);

      const id = randomUUID();
      const evalCase: EvalCase = {
        id,
        roleId: row.roleId,
        rubricVersion: row.rubricVersion,
        inputs: {
          userTurn: row.userTurn ?? "(missing — not stored at verdict time)",
        },
        // output blob is not stored in eval_verdicts (only hash is persisted).
        // Populate manually after export if replay is needed.
        output: {} as unknown,
        expected: { passed: row.passed },
      };

      const dir = join(casesDir, row.roleId);
      if (!existsSync(dir)) await mkdir(dir, { recursive: true });

      const filePath = join(dir, `${id}.json`);
      // Guard against races / re-runs
      if (existsSync(filePath)) continue;

      await writeFile(filePath, JSON.stringify(evalCase, null, 2));
      written++;
    }

    console.log(`Built ${written} new cases for role=${roleArg}`);
  } finally {
    await pool.end();
  }
}

function parseArg(args: string[], flag: string): string | undefined {
  const idx = args.indexOf(flag);
  return idx >= 0 ? args[idx + 1] : undefined;
}
