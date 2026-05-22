import { test, expect } from "@playwright/test";
import { gotoWithPersona } from "./helpers/set-persona";
import { expectAxeClean } from "./helpers/run-axe";

const PERSONAS = ["ama", "diego", "priya"] as const;
const VIEWPORTS = [
  { name: "desktop", w: 1280, h: 800 },
  { name: "tablet", w: 768, h: 1024 },
  { name: "mobile", w: 375, h: 667 }
];

for (const persona of PERSONAS) {
  for (const vp of VIEWPORTS) {
    test(`schema-canvas three-directions persona=${persona} viewport=${vp.name}`, async ({ page }) => {
      await page.setViewportSize({ width: vp.w, height: vp.h });
      await gotoWithPersona(page, "/visual-fixtures/schema-canvas", persona);
      await expect(page.getByTestId("schema-canvas")).toHaveScreenshot(
        `schema-canvas-${persona}-${vp.name}.png`
      );
      await expectAxeClean(page);
    });
  }
}
