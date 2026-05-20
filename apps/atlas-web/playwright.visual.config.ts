// apps/atlas-web/playwright.visual.config.ts
//
// Separate Playwright config for the visual-regression suite. The smoke
// suite (e2e/tests) keeps `playwright.config.ts`; this one targets
// `e2e/visual` and stores baselines under e2e/visual/__snapshots__/.
//
// Differences from the smoke config:
//   - fullyParallel + multiple workers (visual specs are independent).
//   - tighter expect.toHaveScreenshot tolerances (drift surfaces in PRs).
//   - snapshotPathTemplate keeps the per-test PNGs in a stable location
//     so they show up in `git diff` cleanly.
//   - webServer boots `pnpm dev` on :3000 (reused locally if already up).

import { defineConfig, devices } from "@playwright/test";

const PORT = Number(process.env.ATLAS_VISUAL_PORT ?? 3000);

export default defineConfig({
  testDir: "./e2e/visual",
  fullyParallel: true,
  workers: process.env.CI ? 2 : 4,
  retries: process.env.CI ? 1 : 0,
  reporter: process.env.CI ? "github" : "list",
  use: {
    baseURL: `http://localhost:${PORT}`,
    trace: "on-first-retry"
  },
  expect: {
    toHaveScreenshot: {
      maxDiffPixels: 100,
      threshold: 0.1
    }
  },
  snapshotPathTemplate: "{testDir}/__snapshots__/{testFilePath}/{arg}{ext}",
  webServer: {
    command: "pnpm dev",
    url: `http://localhost:${PORT}`,
    timeout: 120 * 1000,
    reuseExistingServer: !process.env.CI
  },
  projects: [
    { name: "chromium", use: { ...devices["Desktop Chrome"] } }
  ]
});
