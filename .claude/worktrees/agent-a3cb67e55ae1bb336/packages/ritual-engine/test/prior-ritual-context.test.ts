import { describe, it, expect } from "vitest";
import { buildPriorRitualContext, isPriorRitualContext } from "../src/prior-ritual-context.js";

describe("PriorRitualContext (Plan K Task 2)", () => {
  it("buildPriorRitualContext packages snapshot fields with the discriminator", () => {
    const ctx = buildPriorRitualContext({
      ritualId: "r-parent",
      artifact: { kind: "plan" },
      developerOutput: { diff: "diff --git a/x b/x", summary: "added x" },
      roleEvents: [{ eventType: "architect.pass2.completed", payload: {} }]
    });
    expect(ctx.kind).toBe("priorRitual");
    expect(ctx.parentRitualId).toBe("r-parent");
    expect(ctx.parentDeveloperOutput?.diff).toContain("diff --git");
  });

  it("isPriorRitualContext returns true for a properly-shaped object", () => {
    const ctx = buildPriorRitualContext({ ritualId: "r-1" });
    expect(isPriorRitualContext(ctx)).toBe(true);
  });

  it("isPriorRitualContext returns false for unrelated objects", () => {
    expect(isPriorRitualContext({ kind: "plan" })).toBe(false);
    expect(isPriorRitualContext(undefined)).toBe(false);
    expect(isPriorRitualContext(null)).toBe(false);
  });

  it("truncates a developer diff exceeding 8000 chars (4k head + 4k tail + marker)", () => {
    const huge = "x".repeat(20000);
    const ctx = buildPriorRitualContext({
      ritualId: "r-1",
      developerOutput: { diff: huge }
    });
    const truncated = ctx.parentDeveloperOutput!.diff;
    expect(truncated.length).toBeLessThan(huge.length);
    expect(truncated).toContain("[12000 chars elided]");
  });
});
