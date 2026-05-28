// Plan C Task 12 — workflow graph view E2E.
//
// Drives the new /projects/[id]/workflow/[wid] route end-to-end:
//   1. Seed a workflow_run with two nodes in known statuses.
//   2. Visit the workflow page.
//   3. Assert the WorkflowGraph renders every seeded node card.
//   4. Assert the status badge on the WorkflowHeader matches the seed.
//
// Requires: ATLAS_FF_WORKFLOW=true on the running dev server, a reachable
// Postgres pointed at by DATABASE_URL, and the ama persona storage state.

import { expect } from "@playwright/test";
import { Pool } from "pg";
import { makeFreshProjectTest } from "../fixtures/index";
import {
  seedWorkflow,
  deleteWorkflow,
  type SeedNode
} from "../fixtures/workflow-seeds";

const test = makeFreshProjectTest({
  persona: "ama",
  projectName: "plan-c-graph",
  withSandbox: false
});

const NODES: ReadonlyArray<SeedNode> = [
  {
    id: "node-backend",
    artifactKind: "backend-rest-api",
    summary: "Build the API",
    dependsOn: [],
    consumes: [],
    status: "running"
  },
  {
    id: "node-frontend",
    artifactKind: "frontend-app",
    summary: "Build the UI",
    dependsOn: ["node-backend"],
    consumes: ["node-backend"],
    status: "pending"
  }
];

test.describe("Plan C — workflow graph view", () => {
  test("renders every seeded node with the right status class", async ({
    freshProject: { page, projectId }
  }) => {
    const pool = new Pool({ connectionString: process.env.DATABASE_URL! });
    const { workflowRunId } = await seedWorkflow(pool, {
      projectId,
      userId: "ama-e2e",
      status: "running",
      nodes: NODES
    });

    try {
      await page.goto(`/projects/${projectId}/workflow/${workflowRunId}`);

      await expect(page.getByTestId("workflow-graph-client")).toBeVisible({
        timeout: 15_000
      });
      await expect(page.getByTestId("workflow-header")).toBeVisible();
      await expect(page.getByTestId("workflow-status-badge")).toHaveText(
        /running/i
      );

      for (const n of NODES) {
        const card = page.getByTestId(`workflow-node-${n.id}`);
        await expect(card).toBeVisible();
        await expect(card).toContainText(n.summary);
        await expect(card).toContainText(n.artifactKind);
      }
    } finally {
      await deleteWorkflow(pool, workflowRunId).catch(() => {});
      await pool.end().catch(() => {});
    }
  });
});
