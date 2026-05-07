// Per-persona × per-viewport snapshots of <DesignerCanvas> wrapping the
// canned <OptionsCard> proposal. ama gets <OutcomeCard>; diego/priya get
// <TechnicalCard>. 3 × 3 = 9 baselines.
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
    test(`<DesignerCanvas> persona=${persona} viewport=${vp.name}`, async ({ page }) => {
      await page.setViewportSize(vp.viewport);
      await gotoWithPersona(page, "/visual-fixtures/designer-canvas", persona);
      await expect(page.getByTestId("options-card")).toHaveScreenshot(
        `designer-canvas-${persona}-${vp.name}.png`
      );
      await expectAxeClean(page);
    });
  }
}
