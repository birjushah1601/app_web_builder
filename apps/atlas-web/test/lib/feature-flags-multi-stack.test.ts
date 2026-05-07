import { describe, it, expect } from "vitest";
import { isFeatureEnabled } from "@/lib/feature-flags";

const src = (env: Record<string, string | undefined>) => ({ readEnv: (n: string) => env[n] });

describe("multi-stack feature flag", () => {
  it("defaults to OFF when ATLAS_FF_MULTI_STACK is unset", () => {
    expect(isFeatureEnabled("multi-stack", src({}))).toBe(false);
  });
  it("returns true for truthy env values", () => {
    for (const v of ["1", "true", "TRUE", "yes", "on"]) {
      expect(isFeatureEnabled("multi-stack", src({ ATLAS_FF_MULTI_STACK: v }))).toBe(true);
    }
  });
  it("returns false for falsy env values", () => {
    for (const v of ["0", "false", "no", "off", ""]) {
      expect(isFeatureEnabled("multi-stack", src({ ATLAS_FF_MULTI_STACK: v }))).toBe(false);
    }
  });
});
