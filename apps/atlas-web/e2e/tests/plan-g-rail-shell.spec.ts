// Plan G — persistent left-rail e2e specs.
//
// Stack: live atlas-web (port 3000) with ATLAS_LIVE_EVENTS=true → real
// Postgres (port 5440) → real Clerk dev tenant. NO mocks; reuses the
// Plan D auth-state pattern (storageState from e2e/auth/diego.json).
//
// Run:
//   cd apps/atlas-web
//   ATLAS_LIVE_EVENTS=true pnpm dev   # in another terminal
//   pnpm test:e2e plan-g-rail-shell.spec.ts
//
// Required env (loaded from apps/atlas-web/.env.local automatically by
// playwright.config.ts):
//   - ATLAS_LIVE_EVENTS=true        (gates the rail mount)
//   - CLERK_SECRET_KEY              (provisions test users via Clerk admin)
//   - ATLAS_TEST_PASSWORD           (password for test users)
//
// These specs each take ~30-45s; the file as a whole runs in <2 minutes.

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

function requireLiveEventsFlag() {
  if (process.env.ATLAS_LIVE_EVENTS !== "true") {
    test.skip(
      true,
      "ATLAS_LIVE_EVENTS!=true; the rail does not mount. Set ATLAS_LIVE_EVENTS=true in .env.local + restart dev server."
    );
  }
}

// ===================================================================
// Spec 1: chat survives navigation between /canvas, /code, /run
// ===================================================================
test.describe("plan-g rail shell: persistent chat", () => {
  test.use({ storageState: TEST_PERSONA_FILE });

  test("ChatPanel DOM persists + textarea value preserved across /canvas → /code → /run", async ({ page }) => {
    test.setTimeout(120_000);
    requireAuthState();
    requireLiveEventsFlag();

    const projectId = await openCanvasOnFreshProject(page);

    // Rail is mounted by [projectId]/layout — must be present on /canvas.
    const rail = page.getByTestId("rail-shell");
    await expect(rail).toBeVisible();

    // Tag the rail with a unique data-attr we set ourselves; if the rail
    // unmounted + remounted across navigation the attr would be gone.
    await rail.evaluate((el) => {
      el.setAttribute("data-persistence-probe", "set-on-canvas");
    });

    // Type a value into the chat textarea — this is the strongest
    // proof of "same React tree": React state survives.
    const textarea = page.getByPlaceholder(/Describe your change/i);
    await textarea.fill("draft message that must survive nav");

    // Navigate to /code — the rail must still be present, the
    // persistence probe attr we set must still be there, and the
    // textarea value must be preserved.
    await page.goto(`/projects/${projectId}/code`);
    await expect(page.getByTestId("rail-shell")).toBeVisible();
    await expect(page.getByTestId("rail-shell")).toHaveAttribute(
      "data-persistence-probe",
      "set-on-canvas"
    );
    await expect(page.getByPlaceholder(/Describe your change/i)).toHaveValue(
      "draft message that must survive nav"
    );

    // Navigate to /run — same assertions.
    await page.goto(`/projects/${projectId}/run`);
    await expect(page.getByTestId("rail-shell")).toBeVisible();
    await expect(page.getByTestId("rail-shell")).toHaveAttribute(
      "data-persistence-probe",
      "set-on-canvas"
    );
    await expect(page.getByPlaceholder(/Describe your change/i)).toHaveValue(
      "draft message that must survive nav"
    );

    // Navigate back to /canvas — page should NOT have its own ChatPanel
    // anymore (flag-on path); only the rail's chat should be visible.
    // We assert this by counting matches: there must be exactly ONE
    // textarea matching the placeholder.
    await page.goto(`/projects/${projectId}/canvas`);
    await expect(page.getByPlaceholder(/Describe your change/i)).toHaveCount(1);
  });
});

// ===================================================================
// Spec 2: switching projects re-keys the rail
// ===================================================================
test.describe("plan-g rail shell: project switch re-key", () => {
  test.use({ storageState: TEST_PERSONA_FILE });

  test("navigating to a different project re-mounts the rail (chat history clears)", async ({ page }) => {
    test.setTimeout(180_000);
    requireAuthState();
    requireLiveEventsFlag();

    // First project
    const projectIdA = await openCanvasOnFreshProject(page);
    const rail = page.getByTestId("rail-shell");
    await expect(rail).toBeVisible();
    await rail.evaluate((el) => {
      el.setAttribute("data-persistence-probe", "set-on-project-A");
    });
    await page
      .getByPlaceholder(/Describe your change/i)
      .fill("project-A draft");

    // Create a second project (project B).
    const projectIdB = await openCanvasOnFreshProject(page);
    expect(projectIdB).not.toBe(projectIdA);

    // The rail must still be present on project B's pages.
    const newRail = page.getByTestId("rail-shell");
    await expect(newRail).toBeVisible();

    // The persistence probe MUST be gone — the layout re-rendered with
    // a new projectId, so React tore down the old subtree and built a
    // fresh one.
    await expect(newRail).not.toHaveAttribute(
      "data-persistence-probe",
      "set-on-project-A"
    );

    // The chat textarea on project B must be empty — fresh React state.
    await expect(page.getByPlaceholder(/Describe your change/i)).toHaveValue("");

    // The header must show project B's id, not project A's.
    const header = page.getByRole("banner");
    await expect(header).toContainText(projectIdB);
    await expect(header).not.toContainText(projectIdA);
  });
});

// ===================================================================
// Helper: navigate to a fresh project's canvas; returns the projectId.
// ===================================================================
async function openCanvasOnFreshProject(page: Page): Promise<string> {
  // Plan UXO Task 1 (prompt-morph) — landing page hosts the PromptForm
  // directly. Fill the prompt + click Create; the server action provisions
  // a project and redirects to its canvas page.
  await page.goto("/");
  const promptTextarea = page.getByPlaceholder(/what do you want to build/i).first();
  await promptTextarea.waitFor({ state: "visible", timeout: 10_000 });
  await promptTextarea.fill(`g-rail (e2e ${Date.now()}-${Math.random().toString(36).slice(2, 6)})`);
  await page.getByRole("button", { name: /^create$/i }).click();
  await page.waitForURL(/\/projects\/[a-f0-9-]+\/canvas/, { timeout: 30_000 });
  const url = page.url();
  const match = url.match(/\/projects\/([a-f0-9-]+)\/canvas/);
  if (!match) throw new Error(`Could not extract projectId from URL: ${url}`);
  return match[1]!;
}
