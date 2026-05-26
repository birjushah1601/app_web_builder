import { integer, jsonb, pgTable, text, timestamp, uuid, index } from "drizzle-orm/pg-core";
import { projects } from "./projects.js";

export const workflowRuns = pgTable(
  "workflow_runs",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    projectId: uuid("project_id").notNull().references(() => projects.projectId, { onDelete: "cascade" }),
    userId: text("user_id").notNull(),
    prompt: text("prompt").notNull(),
    status: text("status").notNull(),
    concurrencyCap: integer("concurrency_cap"),
    dependencyProfile: jsonb("dependency_profile").notNull(),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow()
  },
  (t) => ({
    idxProject: index("idx_workflow_runs_project").on(t.projectId, t.createdAt),
    idxStatus: index("idx_workflow_runs_status").on(t.status)
  })
);

export type WorkflowRunRow = typeof workflowRuns.$inferSelect;
export type NewWorkflowRunRow = typeof workflowRuns.$inferInsert;
