// LEGACY SPEC — skipped 2026-05-24.
//
// Infrastructure-blocked. The test asserts an L4 accessibility-gate
// failure (axe-core finds a violation) → Priya risk-accepts with
// rationale → ritual continues to preview. Two gaps:
//
//   1. **FORCE_L4_FAILURE injection isn't wired.** The original
//      contract was "atlas-test template reads a FORCE_L4_FAILURE env
//      to return a canned a11y failure". That env is read nowhere in
//      production code (verified — grep is empty). The
//      `?__e2e_force_l4_failure=1` query param the test passes is
//      similarly unhandled. A real failure would require either
//      injecting a known-bad component into the developer's diff or
//      mocking AccessibilityRole's report — neither is wired today.
//
//   2. **Risk-accept modal contract is stale.** Today's
//      `RiskAcceptModal` (apps/atlas-web/components/RiskAcceptModal.tsx)
//      ships under `editable-plan` flag and has a different testid
//      surface than the legacy `gate-failure-modal`. A rewrite would
//      need the failure-injection layer first to even reach this UI.
//
// Un-skip when: (a) FORCE_L4_FAILURE (or an equivalent injection point
// like a test-only `ATLAS_E2E_FORCE_GATE_FAILURE=l4`) is wired into
// the AccessibilityRole or its caller, AND (b) the spec is updated
// against the current `RiskAcceptModal` testid surface.

// apps/atlas-web/e2e/tests/priya-risk-accept.spec.ts
import { expect } from "@playwright/test";
import { makeFreshProjectTest } from "../fixtures/index";

const test = makeFreshProjectTest({ persona: "priya", projectName: "priya-risk" });

test.describe.skip("Priya: L4 gate failure → risk-accept → preview", () => {
  test("L4 axe-core failure surfaced; Priya risk-accepts with rationale; preview mounts", async ({ freshProject: { page, projectId, sandboxId } }) => {
    // Navigate to the project; inject a flag that forces axe-core to fail
    // The atlas-test template reads FORCE_L4_FAILURE env to return a canned failure
    await page.goto(`/projects/${projectId}/canvas?__e2e_force_l4_failure=1`);

    await page.getByTestId("intent-input").fill("add a password reset page");
    await page.getByRole("button", { name: /start/i }).click();

    // Wait for Agree → approve (Priya sees raw JSON)
    await expect(page.getByTestId("ritual-step-indicator")).toHaveText(/Agree/i, { timeout: 60_000 });

    // Priya (Tier 3) sees raw JSON artifact
    await expect(page.getByTestId("agree-artifact-raw-json")).toBeVisible();

    await page.getByRole("button", { name: /approve/i }).click();

    // L4 gate failure modal appears
    const gateFailureModal = page.getByTestId("gate-failure-modal");
    await expect(gateFailureModal).toBeVisible({ timeout: 60_000 });
    await expect(gateFailureModal).toContainText(/L4/i);
    await expect(gateFailureModal).toContainText(/axe-core/i);

    // Risk-accept with rationale (Priya-only action)
    await gateFailureModal.getByTestId("risk-accept-rationale-input").fill(
      "Accepted for internal preview; accessibility audit scheduled for Sprint 23."
    );
    await gateFailureModal.getByRole("button", { name: /risk.accept/i }).click();

    // Modal dismissed; Build continues to preview
    await expect(gateFailureModal).not.toBeVisible();
    await expect(page.getByTestId("ritual-step-indicator")).toHaveText(/Build/i, { timeout: 90_000 });
    const previewFrame = page.frameLocator('[data-testid="preview-iframe"]');
    await expect(previewFrame.locator("body")).toBeAttached({ timeout: 60_000 });
  });

  test("Ama cannot risk-accept an L4 gate failure — PersonaGateError surfaces escalation UI", async ({ page }) => {
    // This test does NOT use withFreshProject because it checks a pure UI gate
    // Sign in as Ama and verify the risk-accept button is absent / blocked
    await page.goto("/");
    // Ama's storageState is NOT loaded here — handled by a one-off context
    // (Intentionally omitted from this spec; covered by unit test in ritual-engine)
  });
});
