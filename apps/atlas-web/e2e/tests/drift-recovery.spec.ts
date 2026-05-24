// LEGACY SPEC — skipped 2026-05-24.
//
// Infrastructure-blocked. The test calls `Sandbox.kill()` on a live e2b
// sandbox mid-build and asserts the ritual transitions to `escalated`
// with a graceful error surface. Two gaps prevent rewriting:
//
//   1. No `ritual-escalated` UI surface in current ChatPanel — Plan L's
//      auto-fix loop now intercepts most apply-time failures and retries
//      transparently instead of escalating. The user-visible "escalated"
//      state was replaced by `auto-fix-badge` + `auto-fix-indicator`.
//   2. Killing the sandbox via SDK from outside the app requires the
//      fixture's sandboxId, which today's openCanvasOnFreshProject helper
//      doesn't expose (it relies on the canvas page's server-side
//      getOrProvision, not the e2e fixture's Sandbox.create call). The
//      fixture would need a parallel mode that opens-app + capture-id.
//
// Un-skip when: (a) a "ritual escalated due to drift" testid surface is
// re-introduced (Plan L deliberately removed it), OR (b) the test rewrites
// against a different failure mode that maps to today's auto-fix loop
// (e.g., 3 forced fix-failures → final-failure UI).

// apps/atlas-web/e2e/tests/drift-recovery.spec.ts
import { expect } from "@playwright/test";
import { Sandbox } from "@e2b/sdk";
import { makeFreshProjectTest } from "../fixtures/index";

const test = makeFreshProjectTest({ persona: "ama", projectName: "drift-test" });

test.describe.skip("Drift recovery — sandbox killed mid-build", () => {
  test("killing sandbox during Build transitions ritual to escalated; graceful error UI shown", async ({ freshProject: { page, projectId, sandboxId } }) => {
    await page.goto(`/projects/${projectId}/canvas`);

    await page.getByTestId("intent-input").fill("build a simple landing page");
    await page.getByRole("button", { name: /start/i }).click();

    // Agree step → approve immediately to reach Build
    await expect(page.getByTestId("ritual-step-indicator")).toHaveText(/Agree/i, { timeout: 60_000 });
    await page.getByRole("button", { name: /yes, build it|approve/i }).click();

    // Wait for Build step to begin (spinner visible)
    await expect(page.getByTestId("ritual-step-indicator")).toHaveText(/Build/i, { timeout: 30_000 });
    await expect(page.getByTestId("build-spinner")).toBeVisible();

    // Kill the sandbox externally — simulate drift
    const sandbox = await Sandbox.connect(sandboxId, { apiKey: process.env.E2B_API_KEY! });
    await sandbox.kill();

    // Ritual should detect dead sandbox and transition to escalated within heartbeat timeout
    // The E.4 implementation polls sandbox health every 10s; allow up to 30s here
    await expect(page.getByTestId("ritual-step-indicator")).toHaveText(/escalated/i, { timeout: 30_000 });

    // Graceful error state — user sees a recovery CTA, not a blank screen
    await expect(page.getByTestId("escalation-banner")).toBeVisible();
    await expect(page.getByTestId("escalation-banner")).toContainText(/sandbox.*unavailable|build.*interrupted/i);
    await expect(page.getByRole("button", { name: /retry|restart build/i })).toBeVisible();

    // Page must NOT show an unhandled JS error overlay
    const errorOverlay = page.getByTestId("unhandled-error-overlay");
    await expect(errorOverlay).not.toBeVisible();
  });
});
