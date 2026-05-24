// LEGACY SPEC — skipped 2026-05-24.
//
// Bootstrap Checkpoint modal was removed from the app surface (verified
// 2026-05-24 — no `BootstrapCheckpoint*` components anywhere in
// apps/atlas-web/components, no `bootstrap-checkpoint-*` testids in the
// current UI; only this spec and four other legacy specs still reference
// the testid).
//
// Un-skip when: someone re-implements the per-project HIPAA/compliance
// gate modal that intercepts a ritual before Visualize when the prompt
// hits a regulated-domain keyword (healthcare, finance, etc.).

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
