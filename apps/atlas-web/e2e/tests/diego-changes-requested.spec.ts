// LEGACY SPEC — skipped 2026-05-24.
//
// Request-Changes button was part of the legacy Agree/Approve UI replaced
// by Plan UXO. Verified 2026-05-24: no matches for "Request Changes",
// "request-changes", "RequestChanges", or "changes-requested" in
// apps/atlas-web/components (only legacy e2e specs still reference it).
//
// Today's flow is:
//   - Plan U structured-triage (ATLAS_FF_STRUCTURED_TRIAGE) when the
//     architect needs clarification — surfaced as `architect-needs-input`.
//   - refineRitual (ATLAS_FF_MULTI_TURN) for follow-up turns on an
//     already-applied build — surfaced through ChatPanel's textarea.
//
// Un-skip when: a "request changes" button is re-introduced on
// architect/developer cards (it isn't planned), OR rewrite this spec to
// cover the equivalent refineRitual multi-turn flow (send a second
// "Describe your change…" message after the first apply, assert a second
// architect-plan + developer-output pair lands).

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
