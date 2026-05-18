import { describe, it, expect } from "vitest";
import { isFeatureEnabled, type FeatureFlag } from "@/lib/feature-flags";

describe("Plan UXO flags", () => {
  const cases: Array<[FeatureFlag, string]> = [
    ["prompt-morph", "ATLAS_FF_PROMPT_MORPH"],
    ["mode-toolbar", "ATLAS_FF_MODE_TOOLBAR"],
    ["click-to-edit", "ATLAS_FF_CLICK_TO_EDIT"],
    ["reference-input", "ATLAS_FF_REFERENCE_INPUT"],
    ["editable-plan", "ATLAS_FF_EDITABLE_PLAN"],
    ["element-sliders", "ATLAS_FF_ELEMENT_SLIDERS"]
  ];
  for (const [flag, env] of cases) {
    it(`${flag} ↔ ${env}`, () => {
      expect(isFeatureEnabled(flag, { readEnv: (n) => (n === env ? "true" : undefined) })).toBe(true);
      expect(isFeatureEnabled(flag, { readEnv: () => undefined })).toBe(false);
    });
  }
});
