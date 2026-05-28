// Plan C Task 12 — workflow approval flow E2E.
//
// Seeds an awaiting_approval workflow, asserts the approval panel
// surfaces, edits one node's summary + runMode + priority, clicks
// Approve, and confirms the engine flips the run status (visible in
// the header badge) to "running".

import { expect } from "@playwright/test";
import { Pool } from "pg";
import { makeFreshProjectTest } from "../fixtures/index";
import { seedWorkflow, deleteWorkflow } from "../fixtures/workflow-seeds";

const test = makeFreshProjectTest({
  persona: "ama",
  projectName: "plan-c-approval",
  withSandbox: false
});

test.describe("Plan C — workflow approval", () => {
  test("approval panel appears, edits submit, status flips to running", async ({
    freshProject: { page, projectId }
  }) => {
    const pool = new Pool({ connectionString: process.env.DATABASE_URL! });
    const { workflowRunId } = await seedWorkflow(pool, {
      projectId,
      userId: "ama-e2e",
      status: "awaiting_approval",
      nodes: [
        {
          id: "node-a",
          artifactKind: "backend-rest-api",
          summary: "Build the API",
          status: "pending"
        }
      ]
    });

    try {
      await page.goto(`/projects/${projectId}/workflow/${workflowRunId}`);

      const panel = page.getByTestId("workflow-approval-panel");
      await expect(panel).toBeVisible({ timeout: 15_000 });

      // Rename + bump priority before approving.
      await panel
        .getByTestId("approval-summary-node-a")
        .fill("Build the API (renamed)");
      await panel
        .getByTestId("approval-runmode-node-a")
        .selectOption("background");
      await panel.getByTestId("approval-priority-node-a").fill("5");

      // The diff counter reflects three pending edits (summary + 2 policy).
      await expect(panel).toContainText(/edits pending/i);

      await panel.getByTestId("workflow-approve-btn").click();

      // Engine flips the run status to "running" — the badge follows via SSE.
      await expect(page.getByTestId("workflow-status-badge")).toHaveText(
        /running|completed/i,
        { timeout: 30_000 }
      );
      // Approval panel dismisses once status != awaiting_approval.
      await expect(panel).toBeHidden();
    } finally {
      await deleteWorkflow(pool, workflowRunId).catch(() => {});
      await pool.end().catch(() => {});
    }
  });
});
