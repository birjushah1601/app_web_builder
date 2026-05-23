// Plan F real-stack E2E. Extends the Plan D real-stack pattern.
//
// Stack: live atlas-web (port 3000, started with ATLAS_LIVE_EVENTS=true)
//        → real Postgres (port 5440) → real Claude proxy (port 3456)
//        → real E2B sandbox → real Clerk dev tenant.
//
// Run:
//   ATLAS_LIVE_EVENTS=true pnpm --filter atlas-web dev   # in another terminal
//   pnpm --filter atlas-web test:e2e plan-f-preview-reload.spec.ts
//
// Required env (loaded from apps/atlas-web/.env.local automatically):
//   - CLERK_SECRET_KEY              (provisions test users via Clerk admin)
//   - ATLAS_TEST_PASSWORD           (password for test users)
//   - ATLAS_LLM_BASE_URL            (Claude proxy at :3456)
//   - E2B_API_KEY                   (sandbox provisioning)
//   - ATLAS_DEFAULT_SANDBOX_TEMPLATE (the operator's E2B template)
//   - ATLAS_LIVE_EVENTS=true         (the dev server MUST be started with this)
//
// Wall time: ~4-6 minutes (architect+developer chain is the long pole).

import { test, expect, type Page } from "@playwright/test";
import { existsSync } from "node:fs";
import { resolve } from "node:path";

const TEST_PERSONA_FILE = resolve(__dirname, "..", "auth", "diego.json");

function requireAuthState() {
  if (!existsSync(TEST_PERSONA_FILE)) {
    throw new Error(
      `Auth state missing at ${TEST_PERSONA_FILE}. Run globalSetup once (set ATLAS_TEST_PASSWORD + CLERK_SECRET_KEY in .env.local, then run pnpm test:e2e — it auto-provisions).`
    );
  }
}

// =====================================================================
// Spec 1: iframe auto-reloads after a developer diff applies
// =====================================================================
test.describe("plan-f real stack: preview auto-reload after apply", () => {
  test.use({ storageState: TEST_PERSONA_FILE });

  test("iframe src acquires atlas-reload=<id> after the sandbox apply succeeds", async ({ page }, testInfo) => {
    test.setTimeout(420_000);
    requireAuthState();
    if (process.env.ATLAS_LIVE_EVENTS !== "true") {
      test.skip(true, "ATLAS_LIVE_EVENTS must be true on the dev server for this spec");
    }
    await openCanvasOnFreshProject(page);

    // Capture the iframe src BEFORE submitting the prompt.
    const iframe = page.locator("iframe[title='Live preview']");
    await expect(iframe).toBeVisible({ timeout: 60_000 });
    const srcBefore = await iframe.getAttribute("src");
    expect(srcBefore).toBeTruthy();
    expect(srcBefore!).not.toContain("atlas-reload=");

    // Drive the same prompt the Plan D specs use — proven to apply within ~240s.
    await page.getByPlaceholder(/Describe your change/i).fill(
      "add a /hello page that returns plain text 'Hello from Atlas'"
    );
    await page.getByRole("button", { name: /Send/i }).click();

    // Wait for the apply to land. The sandbox-apply-status panel proves the
    // backend wrote files; the iframe reload follows within ~500ms (debounce).
    const apply = page.getByTestId("sandbox-apply-status");
    await expect(apply).toBeVisible({ timeout: 300_000 });

    // Poll the iframe src for up to 5s after the apply panel renders. The
    // SSE event publishes within ~50ms of apply completion + a 500ms debounce
    // = ~600ms upper bound; 5s is generous.
    await expect.poll(
      async () => (await iframe.getAttribute("src")) ?? "",
      { timeout: 5_000, message: "iframe src never acquired atlas-reload= after apply" }
    ).toContain("atlas-reload=");

    const srcAfter = await iframe.getAttribute("src");
    expect(srcAfter).not.toBe(srcBefore);

    const screenshot = await page.screenshot({ fullPage: true });
    await testInfo.attach("after-auto-reload.png", { body: screenshot, contentType: "image/png" });
  });
});

// =====================================================================
// Spec 2: manual "Reload preview" button cache-busts immediately
// =====================================================================
test.describe("plan-f real stack: manual reload button", () => {
  test.use({ storageState: TEST_PERSONA_FILE });

  test("clicking 'Reload preview' mutates iframe.src to a new atlas-reload value", async ({ page }) => {
    test.setTimeout(180_000);
    requireAuthState();
    await openCanvasOnFreshProject(page);

    // Sandbox cold-start can take 30-90s on first provision for a new project
    // (canvas page calls getSandboxFactory().getOrProvision server-side).
    // Bump to 120s — the previous 60s passed reliably only on warm projects.
    const iframe = page.locator("iframe[title='Live preview']");
    await expect(iframe).toBeVisible({ timeout: 120_000 });

    // Click manual reload — works regardless of whether ATLAS_LIVE_EVENTS is on.
    const button = page.getByTestId("preview-reload-button");
    await expect(button).toBeVisible();
    await button.click();

    await expect.poll(
      async () => (await iframe.getAttribute("src")) ?? "",
      { timeout: 5_000, message: "iframe src never acquired atlas-reload= after manual click" }
    ).toContain("atlas-reload=");

    const srcFirst = await iframe.getAttribute("src");

    // Click again — the cache-buster value must change (Date.now() advances).
    await new Promise((r) => setTimeout(r, 50));
    await button.click();

    await expect.poll(
      async () => (await iframe.getAttribute("src")) ?? "",
      { timeout: 5_000, message: "iframe src did not change on second manual click" }
    ).not.toBe(srcFirst);
  });
});

// =====================================================================
// Helper: navigate to a fresh project's canvas. Copied verbatim from
// plan-d-real-stack.spec.ts — keeping spec files self-contained so they
// can run independently.
// =====================================================================
async function openCanvasOnFreshProject(page: Page): Promise<void> {
  // Plan UXO Task 1 (prompt-morph) — landing page hosts the PromptForm
  // directly. Fill the prompt + click Create; the server action provisions
  // a project and redirects to its canvas page.
  await page.goto("/");
  const promptTextarea = page.getByPlaceholder(/what do you want to build/i).first();
  await promptTextarea.waitFor({ state: "visible", timeout: 10_000 });
  await promptTextarea.fill(`A simple hello-world (e2e ${Date.now()}-${Math.random().toString(36).slice(2, 6)})`);
  await page.getByRole("button", { name: /^create$/i }).click();
  await page.waitForURL(/\/projects\/[a-f0-9-]+\/canvas/, { timeout: 30_000 });
}
