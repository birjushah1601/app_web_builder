// Navigate to a fixture route with the atlas-persona cookie pre-set.
// The cookie is read server-side by the __visual__ pages, so it must be
// in place before page.goto fires the request.

import type { Page } from "@playwright/test";

export type Persona = "ama" | "diego" | "priya";

export async function gotoWithPersona(page: Page, url: string, persona: Persona) {
  await page.context().addCookies([
    {
      name: "atlas-persona",
      value: persona,
      url: "http://localhost:3000"
    }
  ]);
  await page.goto(url);
  await page.waitForLoadState("networkidle");
}
