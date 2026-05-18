// apps/atlas-web/e2e/tests/diego-happy.spec.ts
import { expect } from "@playwright/test";
import { makeFreshProjectTest } from "../fixtures/index";

const test = makeFreshProjectTest({ persona: "diego", projectName: "diego-happy" });

test.describe("Diego: happy path — graph diff in Agree → approve → preview", () => {
  test("Agree step shows graph diff panel; Diego approves; preview mounts", async ({ freshProject: { page, projectId } }) => {
    await page.goto(`/projects/${projectId}/canvas`);

    await page.getByTestId("intent-input").fill("add a user profile page");
    await page.getByRole("button", { name: /start/i }).click();

    // Wait for Agree step
    await expect(page.getByTestId("ritual-step-indicator")).toHaveText(/Agree/i, { timeout: 60_000 });

    // Diego sees graph diff, not plain card
    const agreeCard = page.getByTestId("agree-artifact-card");
    await expect(agreeCard.getByTestId("agree-artifact-graph-diff")).toBeVisible();
    await expect(agreeCard.getByTestId("agree-artifact-plain-summary")).not.toBeVisible();

    // Spec Graph diff must show at least one node addition
    const addedNodes = agreeCard.getByTestId("graph-diff-node-added");
    await expect(addedNodes).not.toHaveCount(0);

    // Approve
    await page.getByRole("button", { name: /approve/i }).click();

    // Preview iframe mounts
    await expect(page.getByTestId("ritual-step-indicator")).toHaveText(/Build/i, { timeout: 90_000 });
    const previewFrame = page.frameLocator('[data-testid="preview-iframe"]');
    await expect(previewFrame.locator("body")).toBeAttached({ timeout: 60_000 });
  });
});
