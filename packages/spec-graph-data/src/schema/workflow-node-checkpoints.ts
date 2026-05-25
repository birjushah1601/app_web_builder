import { jsonb, pgTable, text, timestamp, uuid, index } from "drizzle-orm/pg-core";
import { workflowRuns } from "./workflow-runs.js";

export const workflowNodeCheckpoints = pgTable(
  "workflow_node_checkpoints",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    workflowRunId: uuid("workflow_run_id")
      .notNull()
      .references(() => workflowRuns.id, { onDelete: "cascade" }),
    nodeId: text("node_id").notNull(),
    kind: text("kind").notNull(),
    payload: jsonb("payload").notNull(),
    ritualEventId: text("ritual_event_id"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow()
  },
  (t) => ({
    idxRunNode: index("idx_workflow_checkpoints_run_node").on(t.workflowRunId, t.nodeId, t.createdAt)
  })
);

export type WorkflowCheckpointRow = typeof workflowNodeCheckpoints.$inferSelect;
export type NewWorkflowCheckpointRow = typeof workflowNodeCheckpoints.$inferInsert;
