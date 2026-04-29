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
