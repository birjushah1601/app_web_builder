import { describe, it, expect } from "vitest";
import { BuildReportSchema, BuildErrorKind } from "../src/schema";

describe("BuildReportSchema", () => {
  it("accepts a passing report with empty errors", () => {
    const r = {
      passed: true,
      errorKind: "none" as const,
      template: "atlas-next-ts-v2",
      command: "pnpm exec tsc --noEmit",
      exitCode: 0,
      durationMs: 4200,
      errors: []
    };
    expect(() => BuildReportSchema.parse(r)).not.toThrow();
  });

  it("accepts a failing report with structured errors and optional rawTail", () => {
    const r = {
      passed: false,
      errorKind: "compile" as const,
      template: "atlas-next-ts-v2",
      command: "pnpm exec tsc --noEmit",
      exitCode: 1,
      durationMs: 8800,
      errors: [
        { file: "src/app/page.tsx", line: 288, col: 99, severity: "error", message: "Expected '</', got 'm'", snippet: "'I'm feeling…'" }
      ],
      rawTail: "...stderr…"
    };
    expect(() => BuildReportSchema.parse(r)).not.toThrow();
  });

  it("rejects negative line/col", () => {
    const bad = {
      passed: false,
      errorKind: "compile",
      template: "x",
      command: "x",
      exitCode: 1,
      durationMs: 1,
      errors: [{ file: "f", line: -1, col: 0, severity: "error", message: "x" }]
    };
    expect(() => BuildReportSchema.parse(bad)).toThrow();
  });

  it("enumerates all error kinds", () => {
    const kinds: BuildErrorKind[] = ["compile", "type", "timeout", "sandbox_unreachable", "unsupported_stack", "internal_error", "none"];
    expect(kinds.length).toBe(7);
  });
});
