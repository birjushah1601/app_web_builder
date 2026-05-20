import { describe, it, expect } from "vitest";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { createRegistryWithOverrides, loadSkillsFromDir } from "@atlas/skill-runtime";
import { assembleAccessibilityPrompt } from "../src/assemble-prompt.js";
import { SkillMissingError } from "../src/errors.js";

const here = dirname(fileURLToPath(import.meta.url));
const fixtureDir = join(here, "fixtures", "skills");

describe("assembleAccessibilityPrompt", () => {
  it("concatenates the four required skill bodies with section separators", () => {
    const skills = loadSkillsFromDir(fixtureDir);
    const registry = createRegistryWithOverrides(skills, []);
    const prompt = assembleAccessibilityPrompt(registry, ["wcag-audit", "rtl-layout", "keyboard-nav", "contrast-check"]);
    expect(prompt).toContain("## Skill: wcag-audit");
    expect(prompt).toContain("## Skill: rtl-layout");
    expect(prompt).toContain("## Skill: keyboard-nav");
    expect(prompt).toContain("## Skill: contrast-check");
    expect(prompt).toContain("WCAG");
    expect(prompt).toContain("RTL");
    expect(prompt).toContain("keyboard");
    expect(prompt).toContain("contrast");
    // Order must match requested order
    const idx = (s: string) => prompt.indexOf(s);
    expect(idx("## Skill: wcag-audit")).toBeLessThan(idx("## Skill: rtl-layout"));
    expect(idx("## Skill: rtl-layout")).toBeLessThan(idx("## Skill: keyboard-nav"));
    expect(idx("## Skill: keyboard-nav")).toBeLessThan(idx("## Skill: contrast-check"));
  });

  it("throws SkillMissingError when a required skill is absent", () => {
    const skills = loadSkillsFromDir(fixtureDir).filter((s) => s.frontmatter.name !== "wcag-audit");
    const registry = createRegistryWithOverrides(skills, []);
    expect(() => assembleAccessibilityPrompt(registry, ["wcag-audit", "rtl-layout", "keyboard-nav", "contrast-check"]))
      .toThrow(SkillMissingError);
  });
});
