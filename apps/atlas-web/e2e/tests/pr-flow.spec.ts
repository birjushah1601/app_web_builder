// apps/atlas-web/e2e/tests/pr-flow.spec.ts
//
// Rewritten 2026-05-24 against the actual PrPane surface that ships today.
//
// What the legacy spec asserted (NOT WIRED TODAY):
//   - edit a Monaco field bound to a Spec Graph node
//   - open PR via in-app pane
//   - click an in-pane "merge" button
//   - Spec Graph round-trips through Postgres
// The merge button does not exist in PrPane (lib/actions/code/mergePr.ts is
// defined but not imported anywhere except its own test), the diff viewer
// shows raw git diff (no per-node testids), and "Open PR" pushes to a real
// remote and opens a GitHub URL — none of which is a clean E2E target.
//
// What this spec DOES cover end-to-end:
//   1. Diego provisions a fresh project via the canvas flow.
//   2. /projects/<id>/code loads and the three-pane CodeLayout mounts.
//   3. RightPane defaults to the "PR" tab and PrPane renders its header,
//      "Open PR" trigger, and (with no repo connected) the empty-state copy.
//   4. Switching tabs to "Terminal" then back to "PR" keeps PrPane wired.
//
// Un-skip the full edit→PR→merge→Spec-Graph round trip when (a) PrPane
// imports mergePr() and renders an in-pane merge button, and (b) Monaco
// edits round-trip to spec-graph-data (today saveFile writes to the
// spec-graph-sync mirror only, not the graph itself).
import { test, expect, type Page } from "@playwright/test";
import { PERSONA_STORAGE_STATE } from "../fixtures/personas";

test.use({ storageState: PERSONA_STORAGE_STATE.diego });

test.describe("Diego: Code view → PR pane mounts (sub-set of legacy PR-flow)", () => {
  test("CodeLayout three-pane shell renders with PR tab active and Open PR trigger present", async ({ page }) => {
    test.setTimeout(120_000);
    const projectId = await openCanvasOnFreshProject(page, "A simple landing page");

    // Navigate to the Code view for the same project. The page is a Server
    // Component that gates on Clerk auth + fetches the initial file list
    // from spec-graph-sync; a brand-new project has no mirrored files yet,
    // so we expect the empty-state copy from CodeLayout's main column.
    await page.goto(`/projects/${projectId}/code`);

    // Right pane (PrPane is the default active tab) — assert header copy
    // rendered. PrPane has no testids today; we match against literal text
    // which is stable in the source (components/code/PrPane.tsx L72-79).
    await expect(page.getByText("Pull Requests").first()).toBeVisible({ timeout: 30_000 });
    await expect(page.getByRole("button", { name: /^Open PR$/ })).toBeVisible();

    // With no repo connected (no ?repo= query param), listPrs() returns
    // an empty array and the pane shows its empty-state copy. This proves
    // the server action chain wired up successfully without a connected
    // GitHub repo (graceful degradation).
    await expect(page.getByText(/no open pull requests/i)).toBeVisible({ timeout: 15_000 });

    // The Open PR form is collapsed by default; clicking the trigger
    // should reveal the head/base/title inputs.
    await page.getByRole("button", { name: /^Open PR$/ }).click();
    await expect(page.getByPlaceholder("Head branch")).toBeVisible();
    await expect(page.getByPlaceholder("PR title")).toBeVisible();
    // Re-collapse — the same trigger toggles the form.
    await page.getByRole("button", { name: /^Open PR$/ }).click();
    await expect(page.getByPlaceholder("Head branch")).not.toBeVisible();

    // Tab switching exercises RightPane.tsx state — confirms PrPane is
    // mounted+remounted cleanly rather than leaking listeners or losing
    // the empty-state on re-mount. The Tests + Terminal panes are both
    // currently wired in RightPane.
    await page.getByRole("tab", { name: /^Terminal$/ }).click();
    await expect(page.getByText("Pull Requests").first()).not.toBeVisible();

    await page.getByRole("tab", { name: /^PR$/ }).click();
    await expect(page.getByText("Pull Requests").first()).toBeVisible();
    await expect(page.getByText(/no open pull requests/i)).toBeVisible({ timeout: 15_000 });
  });
});

async function openCanvasOnFreshProject(page: Page, prompt: string): Promise<string> {
  // Plan UXO Task 1 (prompt-morph) — landing page hosts the PromptForm
  // hero. Fill prompt + click Create; server action provisions the project
  // and redirects to its canvas page. We return the projectId parsed from
  // the canvas URL so callers can navigate to other per-project surfaces.
  await page.goto("/");
  const promptTextarea = page.getByPlaceholder(/what do you want to build/i).first();
  await promptTextarea.waitFor({ state: "visible", timeout: 10_000 });
  await promptTextarea.fill(`${prompt} (e2e ${Date.now()}-${Math.random().toString(36).slice(2, 6)})`);
  await page.getByRole("button", { name: /^create$/i }).click();
  await page.waitForURL(/\/projects\/[a-f0-9-]+\/canvas/, { timeout: 30_000 });
  const match = page.url().match(/\/projects\/([a-f0-9-]+)\/canvas/);
  if (!match) throw new Error(`Could not parse projectId from ${page.url()}`);
  return match[1]!;
}
