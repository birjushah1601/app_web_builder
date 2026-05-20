// Per-persona × per-viewport snapshots of <AxisWizard> at step 1 of 3
// (palette axis). 3 × 3 = 9 baselines. Persona is forwarded but the
// axis-wizard layout is currently persona-invariant.
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
    test(`<AxisWizard> step-1 persona=${persona} viewport=${vp.name}`, async ({ page }) => {
      await page.setViewportSize(vp.viewport);
      await gotoWithPersona(page, "/visual-fixtures/axis-wizard", persona);
      await expect(page.getByTestId("axis-wizard")).toHaveScreenshot(
        `axis-wizard-step1-${persona}-${vp.name}.png`
      );
      await expectAxeClean(page);
    });
  }
}
