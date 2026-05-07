// Snapshots the schema-canvas-v1 fixture (tenants + RLS table layout)
// at 3 viewports × 2 personas (diego, priya). 2 × 3 = 6 baselines.
//
// The real <SchemaCanvas> renderer ships in a later S-series plan; the
// fixture renders a deterministic placeholder so this slot exists in
// the suite. Swap in the live renderer when it lands and regenerate.
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
    test(`schema-canvas tenants+RLS persona=${persona} viewport=${vp.name}`, async ({ page }) => {
      await page.setViewportSize({ width: vp.w, height: vp.h });
      await gotoWithPersona(page, "/visual-fixtures/schema-canvas", persona);
      await expect(page.getByTestId("schema-canvas")).toHaveScreenshot(
        `schema-canvas-${persona}-${vp.name}.png`
      );
      await expectAxeClean(page);
    });
  }
}
