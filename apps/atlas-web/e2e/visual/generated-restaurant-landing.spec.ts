// Full-page snapshot of the canned editorial-dark restaurant landing.
// Stands in for "ritual end-to-end produced this" until the live mock-LLM
// pipeline drives the fixture; in the meantime the canned HTML guards
// the editorial-dark token aesthetic from drift.
import { test, expect } from "@playwright/test";
import { expectAxeClean } from "./helpers/run-axe";

test("generated restaurant landing matches baseline", async ({ page }) => {
  await page.setViewportSize({ width: 1280, height: 800 });
  await page.goto("/visual-fixtures/generated-restaurant-landing");
  await page.waitForLoadState("networkidle");
  await expect(page).toHaveScreenshot("generated-restaurant-landing-desktop.png", {
    fullPage: true
  });
  await expectAxeClean(page);
});

test("generated restaurant landing — mobile", async ({ page }) => {
  await page.setViewportSize({ width: 375, height: 667 });
  await page.goto("/visual-fixtures/generated-restaurant-landing");
  await page.waitForLoadState("networkidle");
  await expect(page).toHaveScreenshot("generated-restaurant-landing-mobile.png", {
    fullPage: true
  });
});

test("hero kicker uses editorial-dark accent token", async ({ page }) => {
  await page.goto("/visual-fixtures/generated-restaurant-landing");
  const kicker = page.getByText("Bandra · Fine Dining").first();
  const color = await kicker.evaluate((el) => getComputedStyle(el).color);
  // #fbbf24 → rgb(251, 191, 36)
  expect(color).toBe("rgb(251, 191, 36)");
});
