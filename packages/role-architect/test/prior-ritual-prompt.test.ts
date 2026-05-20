import { describe, it, expect } from "vitest";
import { buildArchitectUserTurn } from "../src/deep-plan.js";
import { buildPriorRitualContext } from "@atlas/ritual-engine";

describe("buildArchitectUserTurn — PriorRitualContext threading (Plan K Task 4)", () => {
  it("when no priorRitual is set, the prompt has no 'Previous turn' section (today's behavior)", () => {
    const out = buildArchitectUserTurn({
      userTurn: "build a thing",
      scope: "new-feature"
    });
    expect(out).not.toMatch(/previous turn/i);
    expect(out).toContain("Scope: new-feature");
    expect(out).toContain("User intent: build a thing");
  });

  it("when priorRitual is set, prepends a 'Previous turn' section with parent's plan + diff", () => {
    const prior = buildPriorRitualContext({
      ritualId: "r-parent",
      artifact: { kind: "plan", title: "add foo" },
      developerOutput: { diff: "diff --git a/foo b/foo\n+++ b/foo", summary: "added foo()" }
    });
    const out = buildArchitectUserTurn({
      userTurn: "rename foo to bar",
      scope: "new-feature",
      priorRitual: prior
    });
    expect(out).toMatch(/previous turn/i);
    expect(out).toContain("add foo");
    expect(out).toContain("diff --git a/foo");
    expect(out).toContain("rename foo to bar");
    expect(out).toContain("Scope: new-feature");
  });

  it("priorRitual without developerOutput renders the artifact section but no diff section", () => {
    const prior = buildPriorRitualContext({
      ritualId: "r-parent",
      artifact: { kind: "plan", title: "explore" }
    });
    const out = buildArchitectUserTurn({
      userTurn: "now build it",
      scope: "new-feature",
      priorRitual: prior
    });
    expect(out).toMatch(/previous turn/i);
    expect(out).toContain("explore");
    expect(out).not.toMatch(/```diff/);
  });

  it("priorRitual that is NOT a PriorRitualContext (legacy shape) is ignored — no preamble", () => {
    const out = buildArchitectUserTurn({
      userTurn: "build a thing",
      scope: "new-feature",
      priorRitual: { kind: "plan" }  // shape that fails isPriorRitualContext
    });
    expect(out).not.toMatch(/previous turn/i);
  });
});

describe("buildArchitectUserTurn — gate findings (Plan L Task 3)", () => {
  it("renders '## Gate findings' section when parentSecurityReport.passed === false", () => {
    const prior = buildPriorRitualContext({
      ritualId: "r-parent",
      securityReport: {
        passed: false,
        issues: [{ severity: "critical", message: "Hardcoded API key in src/foo.ts" }]
      }
    });
    const out = buildArchitectUserTurn({
      userTurn: "address the security findings",
      scope: "new-feature",
      priorRitual: prior
    });
    expect(out).toMatch(/## Gate findings/);
    expect(out).toContain("Hardcoded API key");
    expect(out).toContain("L4 Security");
  });

  it("renders gate-findings for accessibility too", () => {
    const prior = buildPriorRitualContext({
      ritualId: "r-parent",
      accessibilityReport: {
        passed: false,
        issues: [{ severity: "high", message: "Image missing alt text" }]
      }
    });
    const out = buildArchitectUserTurn({
      userTurn: "fix the a11y issues",
      scope: "new-feature",
      priorRitual: prior
    });
    expect(out).toContain("missing alt text");
    expect(out).toContain("L5 Accessibility");
  });

  it("does NOT render '## Gate findings' when both reports are absent or passed", () => {
    const prior = buildPriorRitualContext({
      ritualId: "r-parent",
      securityReport: { passed: true, issues: [] }
    });
    const out = buildArchitectUserTurn({
      userTurn: "iterate", scope: "new-feature", priorRitual: prior
    });
    expect(out).not.toMatch(/## Gate findings/);
  });
});

describe("buildArchitectUserTurn — build errors (Plan L0 Task 14)", () => {
  it("renders no '## Build errors' when priorRitual has no parentBuildReport", () => {
    const prior = buildPriorRitualContext({
      ritualId: "r-prev"
    });
    const out = buildArchitectUserTurn({
      userTurn: "iterate",
      scope: "new-feature",
      priorRitual: prior
    });
    expect(out).not.toMatch(/## Build errors/);
  });

  it("renders '## Build errors' BEFORE '## Gate findings' when both fail", () => {
    const prior = buildPriorRitualContext({
      ritualId: "r-prev",
      buildReport: {
        passed: false,
        errorKind: "compile",
        template: "atlas-next-ts-v2",
        command: "pnpm exec tsc --noEmit",
        errors: [{ file: "src/app/page.tsx", line: 288, col: 99, severity: "error", message: "Expected '</', got 'm'", snippet: "'I'm…'" }]
      },
      securityReport: {
        passed: false,
        issues: [{ severity: "critical", message: "secret leak" }]
      }
    });
    const out = buildArchitectUserTurn({
      userTurn: "fix the build",
      scope: "new-feature",
      priorRitual: prior
    });
    const buildIdx = out.indexOf("## Build errors");
    const gateIdx = out.indexOf("## Gate findings");
    expect(buildIdx).toBeGreaterThanOrEqual(0);
    expect(gateIdx).toBeGreaterThanOrEqual(0);
    expect(buildIdx).toBeLessThan(gateIdx);
  });

  it("renders the file:line:col + message + snippet for each error", () => {
    const prior = buildPriorRitualContext({
      ritualId: "r-prev",
      buildReport: {
        passed: false,
        errorKind: "compile",
        template: "atlas-next-ts-v2",
        command: "pnpm exec tsc --noEmit",
        errors: [{ file: "src/app/page.tsx", line: 288, col: 99, severity: "error", message: "Expected '</', got 'm'", snippet: "'I'm feeling great!'" }]
      }
    });
    const out = buildArchitectUserTurn({
      userTurn: "fix the build",
      scope: "new-feature",
      priorRitual: prior
    });
    expect(out).toMatch(/src\/app\/page\.tsx:288:99/);
    expect(out).toMatch(/Expected '<\/', got 'm'/);
    expect(out).toMatch(/'I'm feeling great!'/);
  });
});
