import { describe, it, expect } from "vitest";
import { isFeatureEnabled } from "@/lib/feature-flags";

describe("editor-layout-v2 feature flag", () => {
  const src = (env: Record<string, string | undefined>) => ({
    readEnv: (n: string) => env[n]
  });

  it("defaults to OFF when ATLAS_EDITOR_LAYOUT_V2 is unset", () => {
    expect(isFeatureEnabled("editor-layout-v2", src({}))).toBe(false);
  });

  it("returns true for truthy env values", () => {
    for (const v of ["1", "true", "TRUE", "yes", "on"]) {
      expect(isFeatureEnabled("editor-layout-v2", src({ ATLAS_EDITOR_LAYOUT_V2: v }))).toBe(true);
    }
  });

  it("returns false for falsy env values", () => {
    for (const v of ["0", "false", "no", "off", ""]) {
      expect(isFeatureEnabled("editor-layout-v2", src({ ATLAS_EDITOR_LAYOUT_V2: v }))).toBe(false);
    }
  });
});
