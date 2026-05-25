import { jsonb, pgTable, text, timestamp, uuid, primaryKey } from "drizzle-orm/pg-core";
import { workflowRuns } from "./workflow-runs.js";

export const workflowNodes = pgTable(
  "workflow_nodes",
  {
    id: text("id").notNull(),
    workflowRunId: uuid("workflow_run_id")
      .notNull()
      .references(() => workflowRuns.id, { onDelete: "cascade" }),
    artifactKind: text("artifact_kind").notNull(),
    summary: text("summary").notNull(),
    dependsOn: jsonb("depends_on").notNull().default([]),
    consumes: jsonb("consumes").notNull().default([]),
    policy: jsonb("policy").notNull(),
    status: text("status").notNull(),
    ritualId: text("ritual_id"),
    artifact: jsonb("artifact"),
    artifactSchemaVersion: text("artifact_schema_version"),
    failure: jsonb("failure"),
    startedAt: timestamp("started_at", { withTimezone: true }),
    completedAt: timestamp("completed_at", { withTimezone: true })
  },
  (t) => ({
    pk: primaryKey({ columns: [t.workflowRunId, t.id] })
  })
);

export type WorkflowNodeRow = typeof workflowNodes.$inferSelect;
export type NewWorkflowNodeRow = typeof workflowNodes.$inferInsert;
