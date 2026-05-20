// Per-persona × per-viewport snapshots of <RefineWizard> at the palette
// step (step 1 of 3). 3 × 3 = 9 baselines. Persona doesn't change the
// wizard layout in v1 but the cookie is set anyway so future variance
// surfaces in the snapshots.
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
    test(`<RefineWizard> palette step persona=${persona} viewport=${vp.name}`, async ({ page }) => {
      await page.setViewportSize(vp.viewport);
      await gotoWithPersona(page, "/visual-fixtures/refine-wizard", persona);
      await expect(page.getByTestId("axis-wizard")).toHaveScreenshot(
        `refine-wizard-palette-${persona}-${vp.name}.png`
      );
      await expectAxeClean(page);
    });
  }
}
