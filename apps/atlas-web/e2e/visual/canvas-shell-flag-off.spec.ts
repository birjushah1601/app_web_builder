// Behavioural-lock spec: must land FIRST in the visual suite.
//
// Intent: prove the visual-fixture surface renders the components in
// isolation (no canvas-shell wrapper, no mode-toggle chrome) so the
// downstream snapshot specs are reading clean component output and not
// accidentally screenshotting the Plan R/G layout chrome.
//
// Why this is the lock: a regression that wraps a fixture in CanvasShell
// (or otherwise drags in shell chrome) would bleed into every other
// baseline in this suite. Catching it here, with deterministic DOM
// assertions and zero baselines, makes the suite cheaper to maintain.
//
// (The plan originally pointed this spec at /projects/test-project/canvas
// to lock the auth-gated flag-OFF layout; with no test-auth fixtures in
// CI yet, we pin against the public fixture surface instead. When the
// auth fixtures land we can add a second spec covering the live route.)
import { test, expect } from "@playwright/test";

const FIXTURE_ROUTES = [
  "/visual-fixtures/empty-canvas",
  "/visual-fixtures/options-card",
  "/visual-fixtures/axis-wizard"
];

test.describe("canvas-shell flag-OFF behavioural lock", () => {
  for (const url of FIXTURE_ROUTES) {
    test(`fixture route ${url} renders without canvas-shell chrome`, async ({ page }) => {
      await page.goto(url);
      await page.waitForLoadState("networkidle");
      await expect(page.getByTestId("canvas-shell")).toHaveCount(0);
      await expect(page.getByTestId("canvas-mode-toggle")).toHaveCount(0);
      await expect(page.getByTestId("rail-shell")).toHaveCount(0);
    });
  }

  test("fixture URL space is reachable in dev/test", async ({ page }) => {
    const res = await page.goto("/visual-fixtures/empty-canvas");
    expect(res?.status()).toBe(200);
  });
});
