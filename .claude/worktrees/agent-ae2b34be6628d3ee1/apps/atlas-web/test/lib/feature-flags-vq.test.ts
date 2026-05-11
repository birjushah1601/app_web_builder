import { describe, it, expect } from "vitest";
import { isFeatureEnabled } from "@/lib/feature-flags";

describe("visual-quality-gate feature flag", () => {
  const src = (env: Record<string, string | undefined>) => ({
    readEnv: (n: string) => env[n]
  });

  it("defaults to OFF when ATLAS_FF_VISUAL_QUALITY_GATE is unset", () => {
    expect(isFeatureEnabled("visual-quality-gate", src({}))).toBe(false);
  });

  it("returns true for truthy env values", () => {
    for (const v of ["1", "true", "TRUE", "yes", "on"]) {
      expect(
        isFeatureEnabled("visual-quality-gate", src({ ATLAS_FF_VISUAL_QUALITY_GATE: v }))
      ).toBe(true);
    }
  });

  it("returns false for falsy env values", () => {
    for (const v of ["0", "false", "no", "off", ""]) {
      expect(
        isFeatureEnabled("visual-quality-gate", src({ ATLAS_FF_VISUAL_QUALITY_GATE: v }))
      ).toBe(false);
    }
  });
});
