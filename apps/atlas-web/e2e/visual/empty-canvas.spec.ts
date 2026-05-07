// Snapshots <EmptyCanvas> at 3 viewports. Persona-invariant — the
// pre-ritual placeholder looks the same for every tier.
import { test, expect } from "@playwright/test";

const VIEWPORTS = [
  { name: "desktop", w: 1280, h: 800 },
  { name: "tablet", w: 768, h: 1024 },
  { name: "mobile", w: 375, h: 667 }
];

for (const vp of VIEWPORTS) {
  test(`<EmptyCanvas> viewport=${vp.name}`, async ({ page }) => {
    await page.setViewportSize({ width: vp.w, height: vp.h });
    await page.goto("/visual-fixtures/empty-canvas");
    await page.waitForLoadState("networkidle");
    await expect(page.getByTestId("empty-canvas")).toHaveScreenshot(
      `empty-canvas-${vp.name}.png`
    );
  });
}
