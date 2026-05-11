import { describe, it, expect } from "vitest";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { SkillRegistry, loadSkillsFromDir } from "@atlas/skill-runtime";
import { assembleBrowserVerificationPrompt } from "../src/assemble-prompt.js";
import { SkillMissingError } from "../src/errors.js";

const here = dirname(fileURLToPath(import.meta.url));
const fixtureDir = join(here, "fixtures", "skills");
const SKILLS = ["page-load-check", "viewport-render-check", "console-error-check", "network-requests-audit"];

describe("assembleBrowserVerificationPrompt", () => {
  it("concatenates the four required skill bodies with section separators in order", () => {
    const skills = loadSkillsFromDir(fixtureDir);
    const registry = new SkillRegistry(skills);
    const prompt = assembleBrowserVerificationPrompt(registry, SKILLS);
    for (const name of SKILLS) {
      expect(prompt).toContain(`## Skill: ${name}`);
    }
    const idx = (s: string) => prompt.indexOf(s);
    expect(idx("## Skill: page-load-check")).toBeLessThan(idx("## Skill: viewport-render-check"));
    expect(idx("## Skill: viewport-render-check")).toBeLessThan(idx("## Skill: console-error-check"));
    expect(idx("## Skill: console-error-check")).toBeLessThan(idx("## Skill: network-requests-audit"));
  });

  it("throws SkillMissingError when a required skill is absent", () => {
    const skills = loadSkillsFromDir(fixtureDir).filter(
      (s) => s.frontmatter.name !== "page-load-check"
    );
    const registry = new SkillRegistry(skills);
    expect(() => assembleBrowserVerificationPrompt(registry, SKILLS)).toThrow(SkillMissingError);
  });
});
