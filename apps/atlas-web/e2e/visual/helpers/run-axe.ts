// Thin wrapper around @axe-core/playwright that lets the caller exclude
// regions that intentionally violate axe rules (e.g. preview iframes whose
// content lives outside our control). Returns the raw AxeResults so the
// caller can assert on .violations.

import AxeBuilder from "@axe-core/playwright";
import type { Page } from "@playwright/test";

export async function runAxe(page: Page, excludeSelectors: string[] = []) {
  const builder = new AxeBuilder({ page });
  for (const sel of excludeSelectors) builder.exclude(sel);
  return builder.analyze();
}
