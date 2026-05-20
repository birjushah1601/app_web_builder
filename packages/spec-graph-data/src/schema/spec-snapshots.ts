import { bigint, index, jsonb, pgTable, text, timestamp, uuid } from "drizzle-orm/pg-core";

export const specSnapshots = pgTable(
  "spec_snapshots",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    projectId: uuid("project_id").notNull(),
    upToEventId: bigint("up_to_event_id", { mode: "bigint" }).notNull(),
    graphData: jsonb("graph_data").notNull().default({}),
    reason: text("reason").notNull(),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow()
  },
  (table) => ({
    idxProjectCreatedAtDesc: index("idx_spec_snapshots_project_created_at_desc").on(table.projectId, table.createdAt)
  })
);

export type SpecSnapshotRow = typeof specSnapshots.$inferSelect;
export type NewSpecSnapshotRow = typeof specSnapshots.$inferInsert;
