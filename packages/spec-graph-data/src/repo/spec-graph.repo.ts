import { drizzle } from "drizzle-orm/node-postgres";
import type { Pool } from "pg";
import { eq, sql } from "drizzle-orm";
import { specGraphs, type SpecGraphRow } from "../schema/index.js";
import { withProjectContext } from "../tenant.js";

// Postgres SQLSTATE for unique_violation
const PG_UNIQUE_VIOLATION = "23505";

function isPgError(err: unknown): err is { code?: string; message?: string; constraint?: string } {
  return typeof err === "object" && err !== null && "code" in err;
}

function unwrapDriverError(err: unknown): unknown {
  // drizzle wraps pg errors in DrizzleQueryError with the original on .cause
  if (typeof err === "object" && err !== null && "cause" in err && (err as { cause?: unknown }).cause) {
    return (err as { cause: unknown }).cause;
  }
  return err;
}

export class SpecGraphRepo {
  constructor(private readonly pool: Pool) {}

  async create(projectId: string, graphData: unknown): Promise<SpecGraphRow> {
    try {
      return await withProjectContext(this.pool, projectId, async (client) => {
        const db = drizzle(client, { schema: { specGraphs } });
        const [row] = await db
          .insert(specGraphs)
          .values({ projectId, graphData: graphData as never })
          .returning();
        if (!row) {
          throw new Error("SpecGraphRepo.create: insert returned no row");
        }
        return row;
      });
    } catch (err) {
      const cause = unwrapDriverError(err);
      if (isPgError(cause) && cause.code === PG_UNIQUE_VIOLATION) {
        throw new Error(
          `SpecGraphRepo.create: duplicate project_id ${projectId} (unique constraint violated)`,
          { cause: cause as Error }
        );
      }
      throw err;
    }
  }
}
