// Navigate to a fixture route with the atlas-persona cookie pre-set.
// The cookie is read server-side by the visual-fixtures pages, so it
// must be in place before page.goto fires the request.

import type { Page } from "@playwright/test";

export type Persona = "ama" | "diego" | "priya";

export async function gotoWithPersona(page: Page, url: string, persona: Persona) {
  // Resolve the cookie URL from the test's effective baseURL so this
  // helper survives ATLAS_VISUAL_PORT overrides + CI.
  const baseURL =
    (page.context() as unknown as { _options?: { baseURL?: string } })._options?.baseURL ??
    "http://localhost:3000";
  await page.context().addCookies([
    {
      name: "atlas-persona",
      value: persona,
      url: baseURL
    }
  ]);
  await page.goto(url);
  await page.waitForLoadState("networkidle");
}
