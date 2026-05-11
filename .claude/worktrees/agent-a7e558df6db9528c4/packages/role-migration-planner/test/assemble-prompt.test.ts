import { describe, it, expect } from "vitest";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { SkillRegistry, loadSkillsFromDir } from "@atlas/skill-runtime";
import { assembleMigrationPlannerPrompt } from "../src/assemble-prompt.js";
import { SkillMissingError } from "../src/errors.js";

const here = dirname(fileURLToPath(import.meta.url));
const fixtureDir = join(here, "fixtures", "skills");
const SKILLS = [
  "assess-source-topology",
  "assess-target-topology",
  "plan-dual-run",
  "plan-traffic-shift",
  "plan-cutover-decommission"
];

describe("assembleMigrationPlannerPrompt", () => {
  it("composes 5 skills in order", () => {
    const skills = loadSkillsFromDir(fixtureDir);
    const registry = new SkillRegistry(skills);
    const prompt = assembleMigrationPlannerPrompt(registry, SKILLS);
    for (const name of SKILLS) {
      expect(prompt).toContain(`## Skill: ${name}`);
    }
    const idx = (s: string) => prompt.indexOf(s);
    expect(idx("## Skill: assess-source-topology")).toBeLessThan(
      idx("## Skill: assess-target-topology")
    );
    expect(idx("## Skill: assess-target-topology")).toBeLessThan(idx("## Skill: plan-dual-run"));
    expect(idx("## Skill: plan-dual-run")).toBeLessThan(idx("## Skill: plan-traffic-shift"));
    expect(idx("## Skill: plan-traffic-shift")).toBeLessThan(
      idx("## Skill: plan-cutover-decommission")
    );
  });

  it("throws SkillMissingError when a skill is absent", () => {
    const skills = loadSkillsFromDir(fixtureDir).filter(
      (s) => s.frontmatter.name !== "plan-dual-run"
    );
    const registry = new SkillRegistry(skills);
    expect(() => assembleMigrationPlannerPrompt(registry, SKILLS)).toThrow(SkillMissingError);
  });
});
