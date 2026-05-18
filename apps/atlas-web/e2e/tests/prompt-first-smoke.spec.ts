/**
 * Prompt-first end-to-end smoke — drives /projects/new through to canvas
 * and reports what's actually visible at each step. Used as a debugging
 * mirror for the human operator: when the chat panel is "blank" or the
 * designer cards don't appear, this spec's failure messages say so.
 */
import { test, expect } from "@playwright/test";
import { PERSONA_STORAGE_STATE } from "../fixtures/personas";

test.use({ storageState: PERSONA_STORAGE_STATE.ama });
test.setTimeout(180_000);

test("prompt-first: prompt+stack pill → canvas → designer cards → preview", async ({ page }) => {
  // Keep this trivial. Architect's triage will ask compliance/payment/auth
  // questions on anything that smells like a real product (booking, payments,
  // user accounts). For the smoke we just want the chain to complete; the
  // quality of the output isn't what we're asserting.
  const PROMPT = "A simple hello-world landing page with a centered heading and one button";

  // ── 1. /projects/new ──
  await page.goto("/projects/new");
  await expect(page.getByRole("heading", { name: /what do you want to build/i }))
    .toBeVisible({ timeout: 10_000 });

  // Stack pill: pick Website.
  const websitePill = page.getByRole("button", { name: /website/i });
  await expect(websitePill).toBeVisible();
  await websitePill.click();
  await expect(websitePill).toHaveAttribute("aria-pressed", "true");

  // Fill prompt.
  await page.getByPlaceholder(/what do you want to build/i).fill(PROMPT);

  // Submit.
  await page.getByRole("button", { name: /^create$/i }).click();

  // ── 2. Should land on /projects/<uuid>/canvas ──
  await page.waitForURL(/\/projects\/[0-9a-f-]+\/canvas/, { timeout: 30_000 });
  const projectId = new URL(page.url()).pathname.split("/")[2]!;
  console.log(`[smoke] landed on canvas for project ${projectId}`);

  // ── 3. RailShell should mount (it hosts ChatPanel via layout.tsx) ──
  const railShell = page.getByTestId("rail-shell");
  await expect(railShell).toBeVisible({ timeout: 10_000 });
  console.log("[smoke] rail-shell mounted ✓");

  // Snapshot what's actually visible on the page to help debug "blank project".
  await page.screenshot({ path: "test-results/canvas-state.png", fullPage: true });
  const bodyText = (await page.locator("body").innerText()).slice(0, 500);
  console.log("[smoke] body text (first 500 chars):", JSON.stringify(bodyText));

  // Check if the prompt text appears anywhere on the page.
  const promptInPage = page.getByText(PROMPT, { exact: false });
  const promptVisible = await promptInPage.isVisible().catch(() => false);
  console.log(`[smoke] prompt text visible on page: ${promptVisible}`);

  // ── 4. RitualTimeline (mounts inside RailShell when live-events is on) ──
  const timeline = page.locator('[data-testid*="ritual"], [data-testid*="timeline"]').first();
  const timelineVisible = await timeline.isVisible().catch(() => false);
  console.log(`[smoke] ritual timeline visible: ${timelineVisible}`);

  // ── 5. Within ~60s the architect should emit + render ──
  await expect(page.getByText(/architect/i)).toBeVisible({ timeout: 60_000 });
  console.log("[smoke] architect row visible ✓");

  // ── 6. The pipeline is auto-resolving (no UI pause), so the canvas may flip
  //    designing → preview faster than the test can observe. We accept EITHER
  //    a designer surface OR a preview iframe as success — within 180s.
  const designerSurface = page.locator('[data-testid*="designer"], [data-testid*="options"]').first();
  const previewIframe = page.locator("iframe").first();
  const eitherVisible = page.locator('[data-testid*="designer"], [data-testid*="options"], iframe').first();
  await expect(eitherVisible).toBeVisible({ timeout: 180_000 });
  console.log("[smoke] design surface OR preview iframe visible ✓");

  // Take a final screenshot of the canvas end-state for the operator.
  await page.screenshot({ path: "test-results/canvas-final.png", fullPage: true });
  const designerVisible = await designerSurface.isVisible().catch(() => false);
  const previewVisible = await previewIframe.isVisible().catch(() => false);
  console.log(`[smoke] final state — designer visible: ${designerVisible}, preview iframe visible: ${previewVisible}`);
});
