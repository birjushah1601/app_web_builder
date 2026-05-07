// Per-persona × per-viewport snapshots of <OptionsCard> in isolation
// (no canvas chrome). 3 × 3 = 9 baselines. Captures the "Recommended"
// badge + reasoning paragraph that only appears on the recommended card.
import { test, expect } from "@playwright/test";
import { gotoWithPersona } from "./helpers/set-persona";
import { expectAxeClean } from "./helpers/run-axe";

const PERSONAS = ["ama", "diego", "priya"] as const;
const VIEWPORTS: Array<{ name: string; viewport: { width: number; height: number } }> = [
  { name: "desktop", viewport: { width: 1280, height: 800 } },
  { name: "tablet", viewport: { width: 768, height: 1024 } },
  { name: "mobile", viewport: { width: 375, height: 667 } }
];

for (const persona of PERSONAS) {
  for (const vp of VIEWPORTS) {
    test(`<OptionsCard> persona=${persona} viewport=${vp.name}`, async ({ page }) => {
      await page.setViewportSize(vp.viewport);
      await gotoWithPersona(page, "/visual-fixtures/options-card", persona);
      await expect(page.getByTestId("options-card")).toHaveScreenshot(
        `options-card-${persona}-${vp.name}.png`
      );
      await expectAxeClean(page);
    });
  }
}
