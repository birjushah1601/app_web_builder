import { bigserial, index, jsonb, pgTable, text, timestamp, uuid } from "drizzle-orm/pg-core";

export const specEvents = pgTable(
  "spec_events",
  {
    id: bigserial("id", { mode: "bigint" }).primaryKey(),
    projectId: uuid("project_id").notNull(),
    eventType: text("event_type").notNull(),
    payload: jsonb("payload").notNull().default({}),
    actor: text("actor"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow()
  },
  (table) => ({
    idxProjectIdDesc: index("idx_spec_events_project_id_desc").on(table.projectId, table.id),
    idxProjectCreatedAtDesc: index("idx_spec_events_project_created_at_desc").on(table.projectId, table.createdAt)
  })
);

export type SpecEventRow = typeof specEvents.$inferSelect;
export type NewSpecEventRow = typeof specEvents.$inferInsert;
