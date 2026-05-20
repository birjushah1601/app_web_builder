import { describe, it, expect, expectTypeOf } from "vitest";
import { RAIL_SHELL_CONFIG, type RailShellConfig } from "@/components/shell/rail-config";

describe("RAIL_SHELL_CONFIG (Plan G — width source for v1; v2 swap target)", () => {
  it("exports a frozen object with widthPx === 360", () => {
    expect(RAIL_SHELL_CONFIG.widthPx).toBe(360);
    expect(Object.isFrozen(RAIL_SHELL_CONFIG)).toBe(true);
  });

  it("RailShellConfig type has exactly { widthPx: number } — v2 may add fields, v1 must not", () => {
    expectTypeOf<RailShellConfig>().toEqualTypeOf<{ readonly widthPx: number }>();
  });
});
