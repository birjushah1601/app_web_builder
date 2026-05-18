// Snapshots <OutcomeCard> at 3 viewports for the ama persona only.
// OutcomeCard is the ama-tier rendering of a recommended direction.
import { test, expect } from "@playwright/test";
import { gotoWithPersona } from "./helpers/set-persona";
import { expectAxeClean } from "./helpers/run-axe";

const VIEWPORTS = [
  { name: "desktop", w: 1280, h: 800 },
  { name: "tablet", w: 768, h: 1024 },
  { name: "mobile", w: 375, h: 667 }
];

for (const vp of VIEWPORTS) {
  test(`<OutcomeCard> ama-tier viewport=${vp.name}`, async ({ page }) => {
    await page.setViewportSize({ width: vp.w, height: vp.h });
    await gotoWithPersona(page, "/visual-fixtures/outcome-card", "ama");
    await expect(page.getByTestId("outcome-card")).toHaveScreenshot(
      `outcome-card-ama-${vp.name}.png`
    );
    await expectAxeClean(page);
  });
}
