import { describe, it, expect } from "vitest";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { createRegistryWithOverrides, loadSkillsFromDir } from "@atlas/skill-runtime";
import { assembleDeveloperPrompt } from "../src/assemble-prompt.js";
import { SkillMissingError } from "../src/errors.js";

const here = dirname(fileURLToPath(import.meta.url));
const fixtureDir = join(here, "fixtures", "skills");

describe("assembleDeveloperPrompt", () => {
  it("concatenates the three required skill bodies with section separators", () => {
    const skills = loadSkillsFromDir(fixtureDir);
    const registry = createRegistryWithOverrides(skills, []);
    const prompt = assembleDeveloperPrompt(registry, ["tdd-feature", "edit-only-what-changed", "runnable-plan"]);
    expect(prompt).toContain("## Skill: tdd-feature");
    expect(prompt).toContain("## Skill: edit-only-what-changed");
    expect(prompt).toContain("## Skill: runnable-plan");
    expect(prompt).toContain("failing tests");
    expect(prompt).toContain("Minimise diff");
    expect(prompt).toContain("TDD tasks");
    // Order must match requested order
    const idx = (s: string) => prompt.indexOf(s);
    expect(idx("## Skill: tdd-feature")).toBeLessThan(idx("## Skill: edit-only-what-changed"));
    expect(idx("## Skill: edit-only-what-changed")).toBeLessThan(idx("## Skill: runnable-plan"));
  });

  it("throws SkillMissingError when a required skill isn't in the registry", () => {
    const skills = loadSkillsFromDir(fixtureDir).filter((s) => s.frontmatter.name !== "tdd-feature");
    const registry = createRegistryWithOverrides(skills, []);
    expect(() => assembleDeveloperPrompt(registry, ["tdd-feature", "edit-only-what-changed", "runnable-plan"]))
      .toThrow(SkillMissingError);
  });
});
