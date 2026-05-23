// LEGACY SPEC — skipped 2026-05-23.
// References UI primitives (intent-input, Start button, preview-iframe testid,
// bootstrap-checkpoint-modal, etc.) that no longer exist after Plans S/T/UXO
// replaced the canvas + form surface. Rewriting against today's PromptForm +
// ChatPanel + canvas-v1 manifest is a per-spec task (~30-60 min each); tracked
// for a follow-up plan. The smoke specs (prompt-first-smoke, prompt-morph,
// smoke-public, ux-overhaul-smoke, plan-d/f/g) cover the current UI flow.

// apps/atlas-web/e2e/tests/diego-changes-requested.spec.ts
import { expect } from "@playwright/test";
import { makeFreshProjectTest } from "../fixtures/index";

const test = makeFreshProjectTest({ persona: "diego", projectName: "diego-revis" });

test.describe.skip("Diego: request changes → re-Visualize → approve", () => {
  test("clicking Request Changes re-triggers Visualize; Diego approves on second pass", async ({ freshProject: { page, projectId } }) => {
    await page.goto(`/projects/${projectId}/canvas`);

    await page.getByTestId("intent-input").fill("add an analytics dashboard");
    await page.getByRole("button", { name: /start/i }).click();

    // First Agree step
    await expect(page.getByTestId("ritual-step-indicator")).toHaveText(/Agree/i, { timeout: 60_000 });

    // Request changes with feedback
    await page.getByTestId("changes-requested-textarea").fill("Please add a date range filter to the dashboard");
    await page.getByRole("button", { name: /request changes/i }).click();

    // Engine transitions back to Visualize (re-run)
    await expect(page.getByTestId("ritual-step-indicator")).toHaveText(/Visualize/i, { timeout: 15_000 });

    // Then back to Agree (second pass)
    await expect(page.getByTestId("ritual-step-indicator")).toHaveText(/Agree/i, { timeout: 60_000 });

    // Graph diff updated — approve
    await page.getByRole("button", { name: /approve/i }).click();

    // Ritual proceeds to Build
    await expect(page.getByTestId("ritual-step-indicator")).toHaveText(/Build/i, { timeout: 90_000 });
  });
});
