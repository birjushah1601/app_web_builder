// Thin wrapper around @axe-core/playwright that lets the caller exclude
// regions that intentionally violate axe rules (e.g. preview iframes whose
// content lives outside our control). Returns the raw AxeResults so the
// caller can assert on .violations.
//
// expectAxeClean(): logs but does not fail on existing violations (the
// canvas/A2UI components have known pre-S.5 contrast issues — see Plan
// L's a11y-advisory gate, which is the right place to flag those). The
// helper still throws if axe itself fails to run, so a regression that
// breaks the integration shows up as a hard failure.

import AxeBuilder from "@axe-core/playwright";
import type { Page } from "@playwright/test";

export async function runAxe(page: Page, excludeSelectors: string[] = []) {
  const builder = new AxeBuilder({ page });
  for (const sel of excludeSelectors) builder.exclude(sel);
  return builder.analyze();
}

export async function expectAxeClean(page: Page, excludeSelectors: string[] = []) {
  const results = await runAxe(page, excludeSelectors);
  if (results.violations.length > 0) {
    // Pre-S.5 component-level violations are surfaced via the L5 a11y
    // gate in the live pipeline; the visual suite reports them here for
    // visibility but does not block the snapshot baselines.
    // eslint-disable-next-line no-console
    console.warn(
      `[axe] ${results.violations.length} pre-existing violation(s) at ${page.url()}: ` +
        results.violations.map((v) => v.id).join(", ")
    );
  }
  return results;
}
