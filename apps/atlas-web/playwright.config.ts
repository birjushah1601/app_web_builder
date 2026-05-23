// apps/atlas-web/playwright.config.ts
import { defineConfig, devices } from "@playwright/test";
import { readFileSync, existsSync } from "node:fs";
import { resolve } from "node:path";

// Load .env.local manually (no dotenv dep). Vars already in process.env win,
// so a CI override is still respected. Atlas's app-router auto-loads
// .env.local for the dev server but Playwright runs as a separate process,
// so we have to thread the test password / base URL ourselves.
// __dirname works because Playwright loads this config as CJS.
const envFile = resolve(__dirname, ".env.local");
if (existsSync(envFile)) {
  for (const line of readFileSync(envFile, "utf8").split(/\r?\n/)) {
    const m = line.match(/^([A-Z_][A-Z0-9_]*)=(.*)$/i);
    if (!m) continue;
    const [, key, rawVal] = m;
    if (process.env[key!] !== undefined) continue;
    let val = rawVal!;
    // Strip trailing "  # comment" — Next.js's dotenv loader does this for
    // the dev server, but a naive regex like the previous version captured
    // the comment as part of the value. That broke checks like
    // `process.env.ATLAS_LIVE_EVENTS === "true"` because the actual value
    // was `"true             # Plan E.0..."`. Quoted values escape this:
    // a `#` inside `"..."` or `'...'` is treated as a literal.
    if (!/^["']/.test(val.trim())) {
      const hashIdx = val.indexOf("#");
      if (hashIdx >= 0) val = val.slice(0, hashIdx);
    }
    val = val.trim().replace(/^["'](.*)["']$/, "$1");
    process.env[key!] = val;
  }
}

export default defineConfig({
  testDir: "./e2e/tests",
  timeout: 120_000,           // generous: E2B cold-start can be ~20s
  expect: { timeout: 15_000 },
  fullyParallel: false,
  workers: 1,                 // serial — avoid sandbox contention
  retries: 0,                 // never retry: flakiness is signal here
  reporter: [["list"], ["html", { open: "never" }]],
  globalSetup: "./e2e/global-setup.ts",
  globalTeardown: "./e2e/global-teardown.ts",
  use: {
    baseURL: process.env.PLAYWRIGHT_BASE_URL ?? "http://localhost:3000",
    trace: "retain-on-failure",
    screenshot: "only-on-failure",
    video: "retain-on-failure",
  },
  projects: [
    {
      name: "chromium",
      use: { ...devices["Desktop Chrome"] },
    },
  ],
});
