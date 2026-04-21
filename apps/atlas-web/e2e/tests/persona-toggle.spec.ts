// apps/atlas-web/e2e/tests/persona-toggle.spec.ts
import { expect } from "@playwright/test";
import { makeFreshProjectTest } from "../fixtures/index.js";

const test = makeFreshProjectTest({ persona: "ama", projectName: "toggle-test", withSandbox: false });

test.describe("Persona toggle — Ama → Diego mid-session", () => {
  test("toggling to Diego in Agree step shows graph diff; ritual state preserved", async ({ freshProject: { page, projectId } }) => {
    await page.goto(`/projects/${projectId}/canvas`);

    await page.getByTestId("intent-input").fill("add a contact form");
    await page.getByRole("button", { name: /start/i }).click();

    // Wait for Agree as Ama (plain card)
    await expect(page.getByTestId("ritual-step-indicator")).toHaveText(/Agree/i, { timeout: 60_000 });
    await expect(page.getByTestId("agree-artifact-plain-summary")).toBeVisible();

    // Toggle persona to Diego
    await page.getByTestId("persona-toggle-button").click();
    const toggleMenu = page.getByTestId("persona-toggle-menu");
    await toggleMenu.getByRole("menuitem", { name: /diego/i }).click();

    // Agree artifact re-renders to graph diff
    await expect(page.getByTestId("agree-artifact-graph-diff")).toBeVisible({ timeout: 10_000 });
    await expect(page.getByTestId("agree-artifact-plain-summary")).not.toBeVisible();

    // Ritual step is still Agree — state preserved
    await expect(page.getByTestId("ritual-step-indicator")).toHaveText(/Agree/i);
  });
});
