import { describe, it, expect } from "vitest";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { createRegistryWithOverrides, loadSkillsFromDir } from "@atlas/skill-runtime";
import { assembleArchitectPrompt } from "../src/assemble-prompt.js";
import { SkillMissingError } from "../src/errors.js";

const here = dirname(fileURLToPath(import.meta.url));
const fixtureDir = join(here, "fixtures", "skills");

describe("assembleArchitectPrompt", () => {
  it("concatenates the three required skill bodies with section separators", () => {
    const skills = loadSkillsFromDir(fixtureDir);
    const registry = createRegistryWithOverrides(skills, []);
    const prompt = assembleArchitectPrompt(registry, ["brainstorm", "spec-graph", "runnable-plan"]);
    expect(prompt).toContain("## Skill: brainstorm");
    expect(prompt).toContain("## Skill: spec-graph");
    expect(prompt).toContain("## Skill: runnable-plan");
    expect(prompt).toContain("Identify ambiguities");
    expect(prompt).toContain("Produce Spec Graph");
    expect(prompt).toContain("TDD tasks");
    // Order must match the requested order
    const idx = (s: string) => prompt.indexOf(s);
    expect(idx("## Skill: brainstorm")).toBeLessThan(idx("## Skill: spec-graph"));
    expect(idx("## Skill: spec-graph")).toBeLessThan(idx("## Skill: runnable-plan"));
  });

  it("throws SkillMissingError when a required skill isn't in the registry", () => {
    const skills = loadSkillsFromDir(fixtureDir).filter((s) => s.frontmatter.name !== "spec-graph");
    const registry = createRegistryWithOverrides(skills, []);
    expect(() => assembleArchitectPrompt(registry, ["brainstorm", "spec-graph", "runnable-plan"]))
      .toThrow(SkillMissingError);
  });
});
