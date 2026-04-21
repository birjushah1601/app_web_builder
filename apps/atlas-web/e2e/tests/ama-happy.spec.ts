// apps/atlas-web/e2e/tests/ama-happy.spec.ts
import { expect } from "@playwright/test";
import { makeFreshProjectTest } from "../fixtures/index.js";

const test = makeFreshProjectTest({ persona: "ama", projectName: "todo-app" });

test.describe("Ama: happy path — build me a todo app", () => {
  test("shows plain-language card, Ama approves, preview renders", async ({ freshProject: { page, projectId } }) => {
    // Navigate to the project canvas
    await page.goto(`/projects/${projectId}/canvas`);
    await expect(page.getByTestId("canvas-view")).toBeVisible();

    // Start the ritual
    await page.getByTestId("intent-input").fill("build me a todo app");
    await page.getByRole("button", { name: /start/i }).click();

    // Visualize step — wait for skeleton to resolve
    await expect(page.getByTestId("ritual-step-indicator")).toHaveText(/Agree/i, { timeout: 60_000 });

    // Agree step — Ama sees a plain-language card, NOT a graph diff
    const agreeCard = page.getByTestId("agree-artifact-card");
    await expect(agreeCard).toBeVisible();
    await expect(agreeCard.getByTestId("agree-artifact-graph-diff")).not.toBeVisible();
    await expect(agreeCard.getByTestId("agree-artifact-plain-summary")).toBeVisible();

    // Approve
    await page.getByRole("button", { name: /yes, build it/i }).click();

    // Build step — wait for preview iframe
    await expect(page.getByTestId("ritual-step-indicator")).toHaveText(/Build/i, { timeout: 90_000 });
    const previewFrame = page.frameLocator('[data-testid="preview-iframe"]');
    await expect(previewFrame.locator("body")).toBeAttached({ timeout: 60_000 });
  });
});
