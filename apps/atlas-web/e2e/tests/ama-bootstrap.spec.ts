// LEGACY SPEC — skipped 2026-05-23.
// References UI primitives (intent-input, Start button, preview-iframe testid,
// bootstrap-checkpoint-modal, etc.) that no longer exist after Plans S/T/UXO
// replaced the canvas + form surface. Rewriting against today's PromptForm +
// ChatPanel + canvas-v1 manifest is a per-spec task (~30-60 min each); tracked
// for a follow-up plan. The smoke specs (prompt-first-smoke, prompt-morph,
// smoke-public, ux-overhaul-smoke, plan-d/f/g) cover the current UI flow.

// apps/atlas-web/e2e/tests/ama-bootstrap.spec.ts
import { expect } from "@playwright/test";
import { makeFreshProjectTest } from "../fixtures/index";

const test = makeFreshProjectTest({ persona: "ama", projectName: "hipaa-escape" });

test.describe.skip("Ama: Bootstrap Checkpoint — HIPAA compliance gate", () => {
  test("healthcare intent triggers Bootstrap Checkpoint; answering HIPAA allows ritual to proceed", async ({ freshProject: { page, projectId } }) => {
    await page.goto(`/projects/${projectId}/canvas`);

    await page.getByTestId("intent-input").fill("build something with healthcare records");
    await page.getByRole("button", { name: /start/i }).click();

    // Bootstrap checkpoint should intercept before Visualize
    const checkpointModal = page.getByTestId("bootstrap-checkpoint-modal");
    await expect(checkpointModal).toBeVisible({ timeout: 30_000 });
    await expect(checkpointModal).toContainText(/compliance/i);

    // Answer HIPAA
    await checkpointModal.getByRole("radio", { name: /hipaa/i }).check();
    await checkpointModal.getByRole("button", { name: /confirm/i }).click();

    // Checkpoint dismissed — ritual now proceeds to Visualize
    await expect(checkpointModal).not.toBeVisible();
    await expect(page.getByTestId("ritual-step-indicator")).toHaveText(/Visualize|Agree/i, { timeout: 60_000 });
  });
});
