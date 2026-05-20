import { describe, it, expect } from "vitest";
import { buildPriorRitualContext } from "../src/prior-ritual-context.js";

describe("PriorRitualContext — gate report fields (Plan L Task 2)", () => {
  it("captures parentSecurityReport when provided", () => {
    const report = { passed: false, issues: [{ severity: "critical", message: "secret leaked" }] };
    const ctx = buildPriorRitualContext({
      ritualId: "r-parent",
      securityReport: report
    });
    expect(ctx.parentSecurityReport).toEqual(report);
  });

  it("captures parentAccessibilityReport when provided", () => {
    const report = { passed: false, issues: [{ severity: "high", message: "missing alt" }] };
    const ctx = buildPriorRitualContext({
      ritualId: "r-parent",
      accessibilityReport: report
    });
    expect(ctx.parentAccessibilityReport).toEqual(report);
  });

  it("both fields can be present simultaneously", () => {
    const ctx = buildPriorRitualContext({
      ritualId: "r-parent",
      securityReport: { passed: false, issues: [] },
      accessibilityReport: { passed: true, issues: [] }
    });
    expect(ctx.parentSecurityReport).toBeDefined();
    expect(ctx.parentAccessibilityReport).toBeDefined();
  });
});

describe("buildPriorRitualContext — parentBuildReport (Plan L0 Task 9)", () => {
  it("threads buildReport through as parentBuildReport", () => {
    const ctx = buildPriorRitualContext({
      ritualId: "r-1",
      buildReport: { passed: false, errorKind: "compile", errors: [{ file: "x.ts", line: 1, col: 1 }] }
    });
    expect(ctx.kind).toBe("priorRitual");
    expect(ctx.parentBuildReport).toBeDefined();
    expect((ctx.parentBuildReport as { errorKind: string }).errorKind).toBe("compile");
  });

  it("leaves parentBuildReport undefined when buildReport is not supplied", () => {
    const ctx = buildPriorRitualContext({ ritualId: "r-2" });
    expect(ctx.parentBuildReport).toBeUndefined();
  });
});
