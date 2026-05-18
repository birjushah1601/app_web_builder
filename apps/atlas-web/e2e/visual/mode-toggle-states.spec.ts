// Snapshots <ModeToggle> across personas × states. ama doesn't see the
// schema mode (skipped). 3 personas × 4 states − 1 skip = 11 baselines.
import { test, expect } from "@playwright/test";
import { gotoWithPersona } from "./helpers/set-persona";

const PERSONAS = ["ama", "diego", "priya"] as const;
const STATES = ["designing", "preview", "schema", "refine"] as const;

for (const persona of PERSONAS) {
  for (const state of STATES) {
    test(`<ModeToggle> persona=${persona} state=${state}`, async ({ page }) => {
      // ama doesn't see schema mode in the live audience filter.
      test.skip(persona === "ama" && state === "schema", "ama is not in the schema audience");
      await gotoWithPersona(page, `/visual-fixtures/mode-toggle?state=${state}`, persona);
      await expect(page.getByTestId("mode-toggle")).toHaveScreenshot(
        `mode-toggle-${persona}-${state}.png`
      );
    });
  }
}
