// Snapshots <TechnicalCard> at 3 viewports × 2 personas (diego, priya).
// 2 × 3 = 6 baselines.
import { test, expect } from "@playwright/test";
import { gotoWithPersona } from "./helpers/set-persona";
import { expectAxeClean } from "./helpers/run-axe";

const PERSONAS = ["diego", "priya"] as const;
const VIEWPORTS = [
  { name: "desktop", w: 1280, h: 800 },
  { name: "tablet", w: 768, h: 1024 },
  { name: "mobile", w: 375, h: 667 }
];

for (const persona of PERSONAS) {
  for (const vp of VIEWPORTS) {
    test(`<TechnicalCard> persona=${persona} viewport=${vp.name}`, async ({ page }) => {
      await page.setViewportSize({ width: vp.w, height: vp.h });
      await gotoWithPersona(page, "/visual-fixtures/technical-card", persona);
      await expect(page.getByTestId("technical-card")).toHaveScreenshot(
        `technical-card-${persona}-${vp.name}.png`
      );
      await expectAxeClean(page);
    });
  }
}
