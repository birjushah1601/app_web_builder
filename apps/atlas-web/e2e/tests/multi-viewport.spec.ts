// apps/atlas-web/e2e/tests/multi-viewport.spec.ts
import { expect } from "@playwright/test";
import { makeFreshProjectTest } from "../fixtures/index.js";

const test = makeFreshProjectTest({ persona: "ama", projectName: "viewport-test" });

test.describe("Multi-viewport preview — toggle 1440 → 768 → 375", () => {
  test("viewport selector updates iframe src query param at each breakpoint", async ({ freshProject: { page, projectId } }) => {
    // Navigate directly to preview (assumes a prior ritual has landed in Build state)
    // Seed the project in Build state via query flag used in e2e
    await page.goto(`/projects/${projectId}/canvas?__e2e_skip_to_build=1`);

    const previewIframe = page.getByTestId("preview-iframe");
    await expect(previewIframe).toBeVisible({ timeout: 60_000 });

    // Desktop (1440) — default
    const src1440 = await previewIframe.getAttribute("src");
    expect(src1440).toContain("viewport=1440");

    // Tablet (768)
    await page.getByTestId("viewport-selector").selectOption("768");
    await expect(previewIframe).toHaveAttribute("src", /viewport=768/);

    // Mobile (375)
    await page.getByTestId("viewport-selector").selectOption("375");
    await expect(previewIframe).toHaveAttribute("src", /viewport=375/);

    // Back to desktop
    await page.getByTestId("viewport-selector").selectOption("1440");
    await expect(previewIframe).toHaveAttribute("src", /viewport=1440/);
  });
});
