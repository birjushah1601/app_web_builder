import { and, asc, desc, eq, gt } from "drizzle-orm";
import { drizzle } from "drizzle-orm/node-postgres";
import type { Pool } from "pg";
import { specEvents, type NewSpecEventRow, type SpecEventRow } from "../schema/index.js";
import { withProjectContext } from "../tenant.js";
import { withSpan } from "../observability.js";

export interface AppendEventInput {
  eventType: string;
  payload: unknown;
  actor: string | null;
}

export class SpecEventRepo {
  constructor(private readonly pool: Pool) {}

  async append(projectId: string, input: AppendEventInput): Promise<SpecEventRow> {
    return withSpan("SpecEventRepo.append", { "atlas.project_id": projectId }, async () =>
      withProjectContext(this.pool, projectId, async (client) => {
        const db = drizzle(client, { schema: { specEvents } });
        const insertRow: NewSpecEventRow = {
          projectId,
          eventType: input.eventType,
          payload: input.payload as never,
          actor: input.actor
        };
        const [row] = await db.insert(specEvents).values(insertRow).returning();
        if (!row) {
          throw new Error("SpecEventRepo.append: insert returned no row");
        }
        return row;
      })
    );
  }

  async listSince(
    projectId: string,
    cursor: bigint,
    opts: { limit?: number } = {}
  ): Promise<SpecEventRow[]> {
    const limit = opts.limit ?? 1000;
    return withSpan("SpecEventRepo.listSince", { "atlas.project_id": projectId }, async () =>
      withProjectContext(this.pool, projectId, async (client) => {
        const db = drizzle(client, { schema: { specEvents } });
        return db
          .select()
          .from(specEvents)
          .where(and(eq(specEvents.projectId, projectId), gt(specEvents.id, cursor)))
          .orderBy(asc(specEvents.id))
          .limit(limit);
      })
    );
  }

  async getLatest(projectId: string): Promise<SpecEventRow | null> {
    return withSpan("SpecEventRepo.getLatest", { "atlas.project_id": projectId }, async () =>
      withProjectContext(this.pool, projectId, async (client) => {
        const db = drizzle(client, { schema: { specEvents } });
        const rows = await db
          .select()
          .from(specEvents)
          .where(eq(specEvents.projectId, projectId))
          .orderBy(desc(specEvents.id))
          .limit(1);
        return rows[0] ?? null;
      })
    );
  }
}
