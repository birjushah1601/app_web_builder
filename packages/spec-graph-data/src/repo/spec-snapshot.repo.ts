import { desc, eq } from "drizzle-orm";
import { drizzle } from "drizzle-orm/node-postgres";
import type { Pool } from "pg";
import { specSnapshots, type NewSpecSnapshotRow, type SpecSnapshotRow } from "../schema/index.js";
import { withProjectContext } from "../tenant.js";

export interface CreateSnapshotInput {
  upToEventId: bigint;
  graphData: unknown;
  reason: "manual" | "compaction" | "recovery";
}

export class SpecSnapshotRepo {
  constructor(private readonly pool: Pool) {}

  async create(projectId: string, input: CreateSnapshotInput): Promise<SpecSnapshotRow> {
    return withProjectContext(this.pool, projectId, async (client) => {
      const db = drizzle(client, { schema: { specSnapshots } });
      const insertRow: NewSpecSnapshotRow = {
        projectId,
        upToEventId: input.upToEventId,
        graphData: input.graphData as never,
        reason: input.reason
      };
      const [row] = await db.insert(specSnapshots).values(insertRow).returning();
      if (!row) {
        throw new Error("SpecSnapshotRepo.create: insert returned no row");
      }
      return row;
    });
  }

  async findLatest(projectId: string): Promise<SpecSnapshotRow | null> {
    return withProjectContext(this.pool, projectId, async (client) => {
      const db = drizzle(client, { schema: { specSnapshots } });
      const rows = await db
        .select()
        .from(specSnapshots)
        .where(eq(specSnapshots.projectId, projectId))
        .orderBy(desc(specSnapshots.createdAt))
        .limit(1);
      return rows[0] ?? null;
    });
  }
}
