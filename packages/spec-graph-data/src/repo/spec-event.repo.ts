import { and, asc, eq, gt } from "drizzle-orm";
import { drizzle } from "drizzle-orm/node-postgres";
import type { Pool } from "pg";
import { specEvents, type NewSpecEventRow, type SpecEventRow } from "../schema/index.js";
import { withProjectContext } from "../tenant.js";

export interface AppendEventInput {
  eventType: string;
  payload: unknown;
  actor: string | null;
}

export class SpecEventRepo {
  constructor(private readonly pool: Pool) {}

  async append(projectId: string, input: AppendEventInput): Promise<SpecEventRow> {
    return withProjectContext(this.pool, projectId, async (client) => {
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
    });
  }

  async listSince(
    projectId: string,
    cursor: bigint,
    opts: { limit?: number } = {}
  ): Promise<SpecEventRow[]> {
    const limit = opts.limit ?? 1000;
    return withProjectContext(this.pool, projectId, async (client) => {
      const db = drizzle(client, { schema: { specEvents } });
      return db
        .select()
        .from(specEvents)
        .where(and(eq(specEvents.projectId, projectId), gt(specEvents.id, cursor)))
        .orderBy(asc(specEvents.id))
        .limit(limit);
    });
  }
}
