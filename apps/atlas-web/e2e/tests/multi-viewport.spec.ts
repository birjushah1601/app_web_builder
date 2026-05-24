// apps/atlas-web/e2e/tests/multi-viewport.spec.ts
//
// Rewritten 2026-05-24 against the current CanvasPreviewToolbar.
// The toolbar exposes three radio buttons (aria-label Desktop|Tablet|Mobile)
// that drive the `width` style on the `canvas-preview-frame` wrapper —
// desktop = "100%", tablet = 768px, mobile = 375px. We assert the wrapper's
// inline width style updates as the user toggles each viewport.
//
// IMPORTANT: with ATLAS_FF_CANVAS_V1=true the preview iframe is mounted by
// PreviewCanvas (registered renderer), which only renders after the architect
// emits `architect.canvas_manifest.emitted` and CanvasShell flips into
// preview mode. So we have to drive a simple architect run first; can't just
// land on /canvas and expect the iframe to be there.
import { test, expect, type Page } from "@playwright/test";
import { PERSONA_STORAGE_STATE } from "../fixtures/personas";

test.use({ storageState: PERSONA_STORAGE_STATE.ama });

test.describe("Multi-viewport preview — toggle Desktop → Tablet → Mobile", () => {
  test("clicking each viewport updates the canvas-preview-frame width", async ({ page }) => {
    test.setTimeout(420_000);
    await openCanvasOnFreshProject(page);

    // Drive an architect run so a canvas_manifest event lands → PreviewCanvas
    // mounts → toolbar + iframe become visible.
    await page.getByPlaceholder(/Describe your change/i).fill(
      "add a /hello page that returns plain text 'Hello'"
    );
    await page.getByRole("button", { name: /^Send$/i }).click();

    const previewIframe = page.locator('iframe[title="Live preview"]');
    await expect(previewIframe).toBeVisible({ timeout: 240_000 });

    const frame = page.getByTestId("canvas-preview-frame");
    await expect(frame).toBeVisible();

    // Desktop is the default; wrapper width = "100%".
    await expect(frame).toHaveAttribute("style", /width:\s*100%/);

    // Tablet → 768px.
    await page.getByRole("radio", { name: "Tablet" }).click();
    await expect(page.getByRole("radio", { name: "Tablet" })).toHaveAttribute("aria-checked", "true");
    await expect(frame).toHaveAttribute("style", /width:\s*768px/);

    // Mobile → 375px.
    await page.getByRole("radio", { name: "Mobile" }).click();
    await expect(page.getByRole("radio", { name: "Mobile" })).toHaveAttribute("aria-checked", "true");
    await expect(frame).toHaveAttribute("style", /width:\s*375px/);

    // Back to Desktop → 100%.
    await page.getByRole("radio", { name: "Desktop" }).click();
    await expect(page.getByRole("radio", { name: "Desktop" })).toHaveAttribute("aria-checked", "true");
    await expect(frame).toHaveAttribute("style", /width:\s*100%/);
  });
});

async function openCanvasOnFreshProject(page: Page): Promise<void> {
  await page.goto("/");
  const promptTextarea = page.getByPlaceholder(/what do you want to build/i).first();
  await promptTextarea.waitFor({ state: "visible", timeout: 10_000 });
  await promptTextarea.fill(`A simple hello-world (e2e ${Date.now()}-${Math.random().toString(36).slice(2, 6)})`);
  await page.getByRole("button", { name: /^create$/i }).click();
  await page.waitForURL(/\/projects\/[a-f0-9-]+\/canvas/, { timeout: 30_000 });
}
