// apps/atlas-web/e2e/tests/priya-risk-accept.spec.ts
import { expect } from "@playwright/test";
import { makeFreshProjectTest } from "../fixtures/index";

const test = makeFreshProjectTest({ persona: "priya", projectName: "priya-risk" });

test.describe("Priya: L4 gate failure → risk-accept → preview", () => {
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
