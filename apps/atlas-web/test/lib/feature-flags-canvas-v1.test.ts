import { describe, it, expect } from "vitest";
import { isFeatureEnabled } from "@/lib/feature-flags";

describe("canvas-v1 feature flag", () => {
  const src = (env: Record<string, string | undefined>) => ({
    readEnv: (n: string) => env[n]
  });

  it("defaults to OFF when ATLAS_FF_CANVAS_V1 is unset", () => {
    expect(isFeatureEnabled("canvas-v1", src({}))).toBe(false);
  });

  it("returns true for truthy env values", () => {
    for (const v of ["1", "true", "TRUE", "yes", "on"]) {
      expect(isFeatureEnabled("canvas-v1", src({ ATLAS_FF_CANVAS_V1: v }))).toBe(true);
    }
  });

  it("returns false for falsy env values", () => {
    for (const v of ["0", "false", "no", "off", ""]) {
      expect(isFeatureEnabled("canvas-v1", src({ ATLAS_FF_CANVAS_V1: v }))).toBe(false);
    }
  });
});
