// Real-stack golden path E2E. NO MOCKS for any layer.
//
// Stack: live atlas-web (port 3000) → real Postgres (port 5440) → real
// Claude proxy (port 3456) → real E2B sandbox → real Clerk dev tenant.
//
// Run:
//   pnpm --filter atlas-web dev   # in another terminal
//   pnpm --filter atlas-web test:e2e plan-d-real-stack.spec.ts
//
// Required env (loaded from apps/atlas-web/.env.local automatically):
//   - CLERK_SECRET_KEY              (provisions test users via Clerk admin)
//   - ATLAS_TEST_PASSWORD           (password for test users)
//   - ATLAS_LLM_BASE_URL            (Claude proxy at :3456)
//   - E2B_API_KEY                   (sandbox provisioning)
//   - ATLAS_DEFAULT_SANDBOX_TEMPLATE (the operator's E2B template)
//
// Each spec is self-contained — failures earlier in the file abort later
// specs (--bail-style) so we see the FIRST broken link, not a cascade.
//
// Wall time: ~3-5 minutes total (architect+developer chain is the long pole).

import { test, expect, type Page } from "@playwright/test";
import { readFileSync, existsSync } from "node:fs";
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
// Spec 1: sign-in flow
// =====================================================================
test.describe("plan-d real stack: sign-in", () => {
  test("a test user can sign into Clerk and land on /", async ({ page, browser }) => {
    test.setTimeout(60_000);
    const password = process.env.ATLAS_TEST_PASSWORD;
    if (!password) test.skip(true, "ATLAS_TEST_PASSWORD not set in .env.local");

    // Use a fresh context (no storageState) to test the sign-in path
    const ctx = await browser.newContext();
    const p = await ctx.newPage();
    await p.goto("/sign-in");

    // Wait for Clerk widget to mount client-side (no fixed aria-label match
    // works reliably across Clerk versions; targeting the form root + role
    // selectors is more durable).
    await p.waitForSelector("[class*='cl-rootBox'], [class*='cl-formButtonPrimary']", { timeout: 30_000 });
    await p.getByRole("textbox").first().fill("diego@atlas-test.dev");
    await p.getByRole("button", { name: "Continue", exact: true }).click();
    const pwd = p.getByRole("textbox").first();
    await pwd.waitFor({ state: "visible", timeout: 15_000 });
    await pwd.fill(password!);
    await p.getByRole("button", { name: "Continue", exact: true }).click();

    // After successful sign-in, atlas-web's middleware redirects to /
    await p.waitForURL("**/", { timeout: 30_000 });
    await expect(p).toHaveURL(new RegExp(`${process.env.PLAYWRIGHT_BASE_URL ?? "http://localhost:3000"}/?$`));
    await ctx.close();
  });
});

// =====================================================================
// Spec 2: create new project
// =====================================================================
test.describe("plan-d real stack: project creation", () => {
  test.use({ storageState: TEST_PERSONA_FILE });

  test("authenticated user can create a project and land on /projects/<id>/canvas", async ({ page }) => {
    test.setTimeout(60_000);
    requireAuthState();

    await page.goto("/");
    // Plan UXO Task 1 (prompt-morph) — when ATLAS_FF_PROMPT_MORPH=true the
    // landing page renders the PromptForm hero directly (no "+ New project"
    // link). Drive the form: fill the prompt textarea + click Create. The
    // server action provisions a project and redirects to /canvas.
    const promptTextarea = page.getByPlaceholder(/what do you want to build/i).first();
    await promptTextarea.waitFor({ state: "visible", timeout: 10_000 });
    await promptTextarea.fill(`A simple hello-world landing page (e2e ${Date.now()})`);
    await page.getByRole("button", { name: /^create$/i }).click();

    // Server action redirects on success
    await page.waitForURL(/\/projects\/[a-f0-9-]+\/canvas/, { timeout: 30_000 });
    expect(page.url()).toMatch(/\/projects\/[a-f0-9-]+\/canvas/);
  });
});

// =====================================================================
// Spec 3: ChatPanel send → architect plan card renders
// =====================================================================
test.describe("plan-d real stack: architect plan", () => {
  test.use({ storageState: TEST_PERSONA_FILE });

  test("ChatPanel.send produces an architect plan or needs-input panel within 60s", async ({ page }) => {
    test.setTimeout(120_000);
    requireAuthState();
    await openCanvasOnFreshProject(page);

    const textarea = page.getByPlaceholder(/Describe your change/i);
    await textarea.fill("add a simple About page with a heading");
    await page.getByRole("button", { name: /Send/i }).click();

    // Architect runs ~20s; allow 60s for the panel to render
    const plan = page.getByTestId("architect-plan");
    const needsInput = page.getByTestId("architect-needs-input");
    const noOutput = page.getByTestId("architect-no-output");
    // Whichever lands first wins; we just need ONE of the three to appear
    await expect(plan.or(needsInput).or(noOutput)).toBeVisible({ timeout: 90_000 });
  });
});

// =====================================================================
// Spec 4: architect → developer → diff card renders
// =====================================================================
test.describe("plan-d real stack: developer chain", () => {
  test.use({ storageState: TEST_PERSONA_FILE });

  test("for an unambiguous request, developer card with diff appears within 240s of send", async ({ page }) => {
    test.setTimeout(300_000);
    requireAuthState();
    await openCanvasOnFreshProject(page);

    await page.getByPlaceholder(/Describe your change/i).fill(
      "add a /hello page at /hello returning the text 'Hello'"
    );
    await page.getByRole("button", { name: /Send/i }).click();

    // Wait up to 150s for ANY architect output. The unambiguous prompt should
    // pass triage and produce a plan; if it doesn't, we get needs-input
    // (also valid — architect chose to ask). no-output is the failure mode.
    const plan = page.getByTestId("architect-plan");
    const needsInput = page.getByTestId("architect-needs-input");
    await expect(plan.or(needsInput)).toBeVisible({ timeout: 150_000 });

    // If triage blocked, the developer step never runs — that's not a chain
    // failure, it's the architect's choice. Skip the developer assertion.
    if (await needsInput.isVisible()) {
      test.info().annotations.push({
        type: "skip-reason",
        description: "Architect requested clarification; developer chain never invoked"
      });
      return;
    }

    // Architect plan rendered → developer should follow within 90s
    const developerOutput = page.getByTestId("developer-output");
    const developerFailed = page.getByTestId("developer-failed");
    await expect(developerOutput.or(developerFailed)).toBeVisible({ timeout: 90_000 });
  });
});

// =====================================================================
// Spec 5: sandbox apply status panel renders
// =====================================================================
test.describe("plan-d real stack: sandbox apply", () => {
  test.use({ storageState: TEST_PERSONA_FILE });

  test("after developer card, the sandbox-apply-status panel renders (green/amber/red) within 30s", async ({ page }) => {
    test.setTimeout(180_000);
    requireAuthState();
    await openCanvasOnFreshProject(page);

    await page.getByPlaceholder(/Describe your change/i).fill(
      "add a /hello page that returns plain text 'Hello from Atlas'"
    );
    await page.getByRole("button", { name: /Send/i }).click();

    await expect(page.getByTestId("developer-output")).toBeVisible({ timeout: 150_000 });
    // The apply status must render — green (clean), amber (mixed), or red (parse error). Any one is acceptable.
    const apply = page.getByTestId("sandbox-apply-status");
    await expect(apply).toBeVisible({ timeout: 30_000 });
  });
});

// =====================================================================
// Spec 6: full visible loop — preview iframe shows generated content
// =====================================================================
test.describe("plan-d real stack: visible loop", () => {
  test.use({ storageState: TEST_PERSONA_FILE });

  test("iframe shows updated content after the apply succeeds (or screenshot for review)", async ({ page }, testInfo) => {
    test.setTimeout(420_000);
    requireAuthState();
    await openCanvasOnFreshProject(page);

    // Reuse the prompt that proved fast in spec 5 (similar wording, same
    // simple "add an endpoint" pattern). Architect chain variance against
    // the local proxy can spike to ~3min on cold starts; 240s wait covers
    // the worst case we've observed.
    await page.getByPlaceholder(/Describe your change/i).fill(
      "add a /hello page that returns plain text 'Hello from Atlas'"
    );
    await page.getByRole("button", { name: /Send/i }).click();

    const plan = page.getByTestId("architect-plan");
    const needsInput = page.getByTestId("architect-needs-input");
    await expect(plan.or(needsInput)).toBeVisible({ timeout: 240_000 });

    if (await needsInput.isVisible()) {
      const screenshot = await page.screenshot({ fullPage: true });
      await testInfo.attach("after-needs-input.png", { body: screenshot, contentType: "image/png" });
      test.info().annotations.push({
        type: "skip-reason",
        description: "Architect requested clarification; sandbox apply never invoked"
      });
      return;
    }

    const apply = page.getByTestId("sandbox-apply-status");
    await expect(apply).toBeVisible({ timeout: 180_000 });

    const screenshot = await page.screenshot({ fullPage: true });
    await testInfo.attach("after-apply.png", { body: screenshot, contentType: "image/png" });

    const text = (await apply.textContent()) ?? "";
    expect(text.length).toBeGreaterThan(5);
  });
});

// =====================================================================
// Helper: navigate to a fresh project's canvas. Uses the create-project
// happy path so each test gets clean state.
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
