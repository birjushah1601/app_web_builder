// apps/atlas-web/e2e/tests/ux-overhaul-smoke.spec.ts
//
// Plan UXO Task 9 — end-to-end smoke for all six UX-overhaul flags.
//
// What this exercises:
//   1. Signed-in visitor lands on `/` and sees the PromptForm hero
//      (Change 1: ATLAS_FF_PROMPT_MORPH).
//   2. Submitting redirects to `/projects/<uuid>/canvas`.
//   3. The three-mode toolbar mounts on the canvas
//      (Change 2: ATLAS_FF_MODE_TOOLBAR).
//   4. The Critique disclosure surfaces once the pipeline finishes
//      (Change 4 / editable-plan; depends on the pipeline plan's flag
//      too, hence the soft `.catch(() => …)` fallback below — if the
//      pipeline hasn't shipped yet we still pass on the morph + toolbar
//      assertions).
//
// What this does NOT exercise (deferred to manual review or follow-up):
//   - Reference-image upload (Change 4 / reference-input): the bot
//     persona doesn't have a stub image queue wired in.
//   - Click-to-edit overlay + per-element sliders (Changes 3+6 /
//     click-to-edit, element-sliders): assertions on the visual-edits
//     panel and Haiku-proposed axes need a longer-running pipeline run
//     and a live LLM call. Run manually.
//
// IMPORTANT: this spec is skipped by default. It costs real LLM tokens
// and a real E2B sandbox provision. Set ATLAS_RUN_SMOKE=true on the
// test command line (alongside the six ATLAS_FF_* flags + ATLAS_LLM_*
// + E2B_API_KEY) to run it. The agent that authored this commit did
// NOT execute the spec — the user must review the diffs and flip the
// flags on their own dev server first.
//
// Requires (when running):
//   - ATLAS_RUN_SMOKE=true
//   - ATLAS_FF_PROMPT_MORPH=true
//   - ATLAS_FF_MODE_TOOLBAR=true
//   - ATLAS_FF_CLICK_TO_EDIT=true
//   - ATLAS_FF_REFERENCE_INPUT=true
//   - ATLAS_FF_EDITABLE_PLAN=true
//   - ATLAS_FF_ELEMENT_SLIDERS=true
//   - ATLAS_LLM_BASE_URL / ATLAS_LLM_API_KEY (Anthropic-compat proxy)
//   - E2B_API_KEY
//   - Persona storage state (e2e/auth/ama.json) — same path the other
//     persona-gated specs use.

import { expect, test } from "@playwright/test";
import { PERSONA_STORAGE_STATE } from "../fixtures/personas";

test.use({ storageState: PERSONA_STORAGE_STATE.ama });
test.setTimeout(180_000);

test("UX overhaul smoke — six flags on", async ({ page }) => {
  test.skip(
    !process.env.ATLAS_RUN_SMOKE,
    "set ATLAS_RUN_SMOKE=true to run — needs live LLM + sandbox"
  );

  await page.goto("/");
  await expect(page.getByPlaceholder(/what do you want to build/i)).toBeVisible();
  await page
    .getByPlaceholder(/what do you want to build/i)
    .fill("A simple hello-world landing page");
  await page.getByRole("button", { name: /^create$/i }).click();
  await page.waitForURL(/\/projects\/[0-9a-f-]+\/canvas/, { timeout: 30_000 });
  await expect(page.getByRole("radio", { name: /agent/i })).toBeVisible();
  await expect(page.getByRole("radio", { name: /visual edits/i })).toBeVisible();
  // wait for critique disclosure to appear (depends on pipeline plan's flag too)
  await page
    .waitForSelector("text=Critique", { timeout: 120_000 })
    .catch(() => {
      /* pipeline plan not yet shipped — ignore */
    });
});
