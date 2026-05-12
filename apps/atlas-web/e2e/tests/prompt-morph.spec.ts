// apps/atlas-web/e2e/tests/prompt-morph.spec.ts
//
// Plan UXO change 1 — single-page morph. With ATLAS_FF_PROMPT_MORPH on,
// signed-in visitors to `/` see the PromptForm as a hero (not just a
// project list). Submitting the form fires the project-creation server
// action which redirects to `/projects/<uuid>/canvas`.
//
// This spec is intentionally narrow:
//  1. textarea with `data-prompt-input` is visible on `/`,
//  2. submitting redirects to `/projects/<uuid>/canvas`.
//
// We do NOT assert anything about the view-transition animation itself —
// Playwright runs in Chromium where `startViewTransition` exists, so the
// transition fires, but the assertion surface here is the URL change.
// Firefox parity (graceful fallback) is exercised in the unit test on
// the PromptForm itself.
//
// Requires: ATLAS_FF_PROMPT_MORPH=true on the dev server. Persona storage
// state ensures the visitor is signed in (otherwise middleware redirects
// to /sign-in and we'd test nothing).

import { expect, test } from "@playwright/test";
import { PERSONA_STORAGE_STATE } from "../fixtures/personas";

test.use({ storageState: PERSONA_STORAGE_STATE.ama });

test.describe("Plan UXO: single-page morph", () => {
  test("prompt hero is visible on / and submit redirects to canvas", async ({ page }) => {
    test.skip(
      process.env.ATLAS_FF_PROMPT_MORPH !== "true",
      "Requires ATLAS_FF_PROMPT_MORPH=true on the test server"
    );

    await page.goto("/");

    // Hero textarea — marked with data-prompt-input so the view-transition
    // CSS picks it up.
    const textarea = page.locator("textarea[data-prompt-input]");
    await expect(textarea).toBeVisible();

    await textarea.fill("A simple hello-world landing page");
    await page.getByRole("button", { name: /^create$/i }).click();

    // submitPromptedProject creates a project and redirects to its canvas.
    await page.waitForURL(/\/projects\/[0-9a-f-]+\/canvas/, { timeout: 30_000 });
  });
});
