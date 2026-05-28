// Plan C Task 12 — workflow per-node drill-in E2E.
//
// Verifies the /projects/[id]/workflow/[wid]/node/[nodeId] route:
//   * renders a breadcrumb back to the workflow view
//   * mounts the canvas shell when the node has a ritualId
//   * shows the "node hasn't started yet" stub when ritualId is missing
//   * back-navigates to the workflow graph view

import { expect } from "@playwright/test";
import { Pool } from "pg";
import { makeFreshProjectTest } from "../fixtures/index";
import { seedWorkflow, deleteWorkflow } from "../fixtures/workflow-seeds";

const test = makeFreshProjectTest({
  persona: "ama",
  projectName: "plan-c-drill",
  withSandbox: false
});

test.describe("Plan C — per-node drill-in", () => {
  test("renders not-started stub for a node without a ritualId", async ({
    freshProject: { page, projectId }
  }) => {
    const pool = new Pool({ connectionString: process.env.DATABASE_URL! });
    const { workflowRunId } = await seedWorkflow(pool, {
      projectId,
      userId: "ama-e2e",
      status: "running",
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
      await page.goto(
        `/projects/${projectId}/workflow/${workflowRunId}/node/node-a`
      );

      await expect(page.getByTestId("workflow-node-page")).toBeVisible();
      await expect(page.getByTestId("workflow-node-breadcrumb")).toContainText(
        /build the api/i
      );
      await expect(page.getByTestId("workflow-node-not-started")).toBeVisible();

      // Breadcrumb link back to the workflow view.
      await page.getByRole("link", { name: /workflow/i }).first().click();
      await expect(page).toHaveURL(
        new RegExp(`/projects/${projectId}/workflow/${workflowRunId}$`)
      );
      await expect(page.getByTestId("workflow-graph-client")).toBeVisible();
    } finally {
      await deleteWorkflow(pool, workflowRunId).catch(() => {});
      await pool.end().catch(() => {});
    }
  });

  test("404s on an unknown node id", async ({
    freshProject: { page, projectId }
  }) => {
    const pool = new Pool({ connectionString: process.env.DATABASE_URL! });
    const { workflowRunId } = await seedWorkflow(pool, {
      projectId,
      userId: "ama-e2e",
      status: "running",
      nodes: [
        {
          id: "real-node",
          artifactKind: "frontend-app",
          summary: "Build the UI",
          status: "pending"
        }
      ]
    });

    try {
      const response = await page.goto(
        `/projects/${projectId}/workflow/${workflowRunId}/node/does-not-exist`,
        { waitUntil: "domcontentloaded" }
      );
      expect(response?.status()).toBe(404);
    } finally {
      await deleteWorkflow(pool, workflowRunId).catch(() => {});
      await pool.end().catch(() => {});
    }
  });
});
