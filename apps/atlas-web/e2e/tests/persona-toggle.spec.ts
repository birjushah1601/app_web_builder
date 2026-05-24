// apps/atlas-web/e2e/tests/persona-toggle.spec.ts
//
// Rewritten 2026-05-24 (PR #45) — PersonaToggle is now mounted in the
// project topNav via `<PersonaToggleClient />`, wired to
// `setPersonaOverride` Server Action + router.refresh() so the
// displayed persona updates without a full page reload.
//
// What this test proves:
//   1. The PersonaToggle host renders inside the project topNav
//      (data-testid="persona-toggle-host").
//   2. Clicking the "diego" pill calls setPersonaOverride, which
//      updates PreferencesRepo and re-renders the layout.
//   3. After the toggle, the "diego" pill is aria-pressed=true and
//      the other pills are aria-pressed=false.
//   4. Reloading the page persists the new persona (override is
//      stored in the DB, not just in client state).
import { test, expect } from "@playwright/test";
import { PERSONA_STORAGE_STATE } from "../fixtures/personas";

test.use({ storageState: PERSONA_STORAGE_STATE.ama });

test.describe("Persona toggle — Ama → Diego mid-session", () => {
  test("toggle PersonaToggle from Ama to Diego; reload persists override", async ({ page }) => {
    test.setTimeout(120_000);

    // Land on a freshly-created project's canvas — PromptForm path.
    // We don't drive a full ritual; this test only exercises the
    // topNav PersonaToggle, which is project-scoped.
    await page.goto("/");
    const promptTextarea = page.getByPlaceholder(/what do you want to build/i).first();
    // 30s wait — first visit to `/` triggers Next.js dev-mode compile
    // of the LandingPage server component which can take 15-25s on a
    // cold dev server.
    await promptTextarea.waitFor({ state: "visible", timeout: 30_000 });
    await promptTextarea.fill(`persona-toggle test (${Date.now()}-${Math.random().toString(36).slice(2, 6)})`);
    await page.getByRole("button", { name: /^create$/i }).click();
    await page.waitForURL(/\/projects\/[a-f0-9-]+\/canvas/, { timeout: 60_000 });

    // The PersonaToggle host MUST be present in the layout's topNav.
    const host = page.getByTestId("persona-toggle-host");
    await expect(host).toBeVisible({ timeout: 10_000 });

    // Ama's persona is the default (storageState comes from PERSONA_STORAGE_STATE.ama).
    // The PersonaToggle inside the host uses aria-pressed for active state.
    const ama = host.getByRole("button", { name: /ama/i });
    const diego = host.getByRole("button", { name: /diego/i });
    await expect(ama).toHaveAttribute("aria-pressed", "true");
    await expect(diego).toHaveAttribute("aria-pressed", "false");

    // Click Diego.
    await diego.click();

    // Optimistic state flip is immediate; the action + router.refresh
    // round-trip can take a beat. Wait up to 15s for the aria-pressed
    // to settle on Diego.
    await expect(diego).toHaveAttribute("aria-pressed", "true", { timeout: 15_000 });
    await expect(ama).toHaveAttribute("aria-pressed", "false");

    // Reload the page — the override should persist because
    // setPersonaOverride writes to PreferencesRepo (Postgres).
    await page.reload({ waitUntil: "domcontentloaded" });
    const hostAfter = page.getByTestId("persona-toggle-host");
    await expect(hostAfter).toBeVisible({ timeout: 30_000 });
    await expect(hostAfter.getByRole("button", { name: /diego/i })).toHaveAttribute(
      "aria-pressed",
      "true",
      { timeout: 10_000 }
    );
  });
});
