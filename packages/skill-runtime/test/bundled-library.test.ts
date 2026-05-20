import { describe, it, expect } from "vitest";
import { loadBundledSkills } from "../src/helpers.js";

describe("loadBundledSkills (post-C.2)", () => {
  it("returns at least 40 skills from the bundled library", () => {
    const skills = loadBundledSkills();
    expect(skills.length).toBeGreaterThanOrEqual(40);
  });

  it("includes the canonical Architect skills", () => {
    const skills = loadBundledSkills();
    const names = new Set(skills.map((s) => s.frontmatter.name));
    for (const expected of ["brainstorm", "spec-graph", "runnable-plan", "visualize-diff", "approve-or-reject"]) {
      expect(names.has(expected)).toBe(true);
    }
  });

  it("includes every test-generator with a node:<kind> activate_on pattern", () => {
    const skills = loadBundledSkills();
    const testGens = skills.filter((s) => s.frontmatter.name.startsWith("gen-test-"));
    expect(testGens.length).toBeGreaterThanOrEqual(14);
    for (const skill of testGens) {
      expect(skill.frontmatter.activate_on[0]).toMatch(/^node:/);
    }
  });
});
