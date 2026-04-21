// apps/atlas-web/e2e/tests/latency.spec.ts
import { expect } from "@playwright/test";
import { makeFreshProjectTest } from "../fixtures/index.js";

const test = makeFreshProjectTest({ persona: "ama", projectName: "latency-test", withSandbox: false });

const P50_BUDGET_MS = 200;
const RUNS = 5;

test.describe("Latency: cosmetic edit p50 < 200ms", () => {
  test(`cosmetic button-color edit completes in under ${P50_BUDGET_MS}ms p50 over ${RUNS} runs`, async ({ freshProject: { page, projectId } }) => {
    // Navigate to code view (where single-field edits are dispatched)
    await page.goto(`/projects/${projectId}/code`);
    await expect(page.getByTestId("monaco-editor")).toBeVisible({ timeout: 30_000 });

    const durations: number[] = [];

    for (let i = 0; i < RUNS; i++) {
      // Each iteration: change the primary button color (cosmetic-class field)
      const start = Date.now();

      await page.getByTestId("spec-field-primaryButtonColor").fill(`#${(i * 0x111111).toString(16).padStart(6, "0")}`);
      await page.keyboard.press("Tab"); // commit the field edit

      // Wait for the edit-confirmed indicator (gate scheduler emits "cosmetic-applied")
      await expect(page.getByTestId("edit-status-indicator")).toHaveAttribute("data-status", "applied");

      durations.push(Date.now() - start);
    }

    const sorted = [...durations].sort((a, b) => a - b);
    const p50 = sorted[Math.floor(RUNS / 2)];
    console.log(`Cosmetic edit latencies (ms): ${durations.join(", ")} — p50: ${p50}ms`);

    expect(p50, `p50 ${p50}ms exceeds ${P50_BUDGET_MS}ms budget`).toBeLessThan(P50_BUDGET_MS);
  });
});
