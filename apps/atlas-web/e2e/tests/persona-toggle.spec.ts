// apps/atlas-web/e2e/tests/persona-toggle.spec.ts
//
// SKIPPED 2026-05-24 — sharper rationale than the previous blanket "legacy UI"
// comment. Investigated for rewrite against the post-Plans S/T/UXO UI;
// CONCLUSION: the contract this spec asserts does not exist in the running app.
//
// What today's UI provides:
//   - components/PersonaToggle.tsx exists but is NOT mounted on ANY page.
//     Verified via `grep -r "PersonaToggle"` → only its own unit test imports it.
//   - app/projects/[projectId]/layout.tsx reads persona server-side via
//     PreferencesRepo.getOverride() and renders it as read-only text:
//       <span ...>Persona: {persona}</span>
//   - lib/actions/setPersonaOverride.ts exists as a server action but has zero
//     client-side caller wired into a button/menu/select.
//
// Therefore no mid-session UI toggle can be exercised by a Playwright spec —
// there is no button to click, no menu to open, no testid to query. The spec's
// previous assertions (persona-toggle-button, persona-toggle-menu, plain card
// → graph diff re-render) all describe a never-shipped contract.
//
// Unskip when: (a) PersonaToggle gets mounted into TopNav or RailShell AND
// (b) it's wired to setPersonaOverride such that the rendered "Persona: X"
// text in the topNav reflects the new value without a full page reload.
import { test } from "@playwright/test";
import { PERSONA_STORAGE_STATE } from "../fixtures/personas";

test.use({ storageState: PERSONA_STORAGE_STATE.ama });

test.describe.skip("Persona toggle — Ama → Diego mid-session", () => {
  test("toggling persona mid-session updates topNav display", async () => {
    // Intentionally empty — see header comment for rationale.
  });
});
