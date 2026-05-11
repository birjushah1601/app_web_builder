import { drizzle } from "drizzle-orm/node-postgres";
import type { Pool } from "pg";
import { eq, sql } from "drizzle-orm";
import type { GraphValidator, ValidationResult } from "@atlas/spec-graph-schema";
import { specGraphs, type SpecGraphRow } from "../schema/index.js";
import { withProjectContext } from "../tenant.js";
import { withSpan } from "../observability.js";

// Postgres SQLSTATE for unique_violation
const PG_UNIQUE_VIOLATION = "23505";

export class GraphValidationError extends Error {
  readonly result: ValidationResult;
  constructor(result: ValidationResult) {
    super(
      `spec-graph validation failed with ${result.issues.length} issue(s): ${result.issues
        .slice(0, 3)
        .map((i) => i.code)
        .join(", ")}${result.issues.length > 3 ? ", ..." : ""}`
    );
    this.name = "GraphValidationError";
    this.result = result;
  }
}

export interface SpecGraphRepoOptions {
  validator?: GraphValidator;
}

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
  private readonly validator: GraphValidator | undefined;

  constructor(private readonly pool: Pool, opts: SpecGraphRepoOptions = {}) {
    this.validator = opts.validator;
  }

  async create(projectId: string, graphData: unknown): Promise<SpecGraphRow> {
    if (this.validator) {
      const result = this.validator(graphData);
      if (!result.ok) throw new GraphValidationError(result);
    }
    return withSpan("SpecGraphRepo.create", { "atlas.project_id": projectId }, async () => {
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
    });
  }

  async findByProjectId(projectId: string): Promise<SpecGraphRow | null> {
    return withSpan("SpecGraphRepo.findByProjectId", { "atlas.project_id": projectId }, async () =>
      withProjectContext(this.pool, projectId, async (client) => {
        const db = drizzle(client, { schema: { specGraphs } });
        const rows = await db.select().from(specGraphs).where(eq(specGraphs.projectId, projectId)).limit(1);
        return rows[0] ?? null;
      })
    );
  }

  async updateGraphData(
    projectId: string,
    graphData: unknown,
    currentEventSeq: bigint
  ): Promise<SpecGraphRow> {
    if (this.validator) {
      const result = this.validator(graphData);
      if (!result.ok) throw new GraphValidationError(result);
    }
    return withSpan("SpecGraphRepo.updateGraphData", { "atlas.project_id": projectId }, async () =>
      withProjectContext(this.pool, projectId, async (client) => {
        const db = drizzle(client, { schema: { specGraphs } });
        const [row] = await db
          .update(specGraphs)
          .set({
            graphData: graphData as never,
            currentEventSeq,
            updatedAt: sql`now()`
          })
          .where(eq(specGraphs.projectId, projectId))
          .returning();
        if (!row) {
          throw new Error(`SpecGraphRepo.updateGraphData: spec graph not found for project ${projectId}`);
        }
        return row;
      })
    );
  }
}
