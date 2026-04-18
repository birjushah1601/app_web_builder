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
}
