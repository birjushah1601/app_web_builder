import { describe, expect, it } from "vitest";
import { SkillRegistry } from "../src/registry.js";
import { MockIntentClassifier } from "../src/classifier.js";
import type { Skill } from "../src/skill.js";

function makeSkill(name: string, activate_on: string[]): Skill {
  return {
    frontmatter: { name, description: `Fixture ${name}`, activate_on },
    body: `# ${name}`,
    sourcePath: `/virtual/${name}.md`
  };
}

describe("SkillRegistry.match", () => {
  const skills = [
    makeSkill("brainstorm", ["brainstorm", "explore"]),
    makeSkill("tdd-feature", ["tdd", "tests"])
  ];

  it("returns matching skills for a recognised intent", async () => {
    const classifier = new MockIntentClassifier(
      skills.map((s) => ({ name: s.frontmatter.name, activate_on: s.frontmatter.activate_on }))
    );
    const reg = new SkillRegistry(skills, classifier);
    const result = await reg.match("let's brainstorm");
    expect(result.map((s) => s.frontmatter.name)).toContain("brainstorm");
  });

  it("returns empty array for an unrecognised intent", async () => {
    const classifier = new MockIntentClassifier(
      skills.map((s) => ({ name: s.frontmatter.name, activate_on: s.frontmatter.activate_on }))
    );
    const reg = new SkillRegistry(skills, classifier);
    const result = await reg.match("deploy to kubernetes");
    expect(result).toHaveLength(0);
  });

  it("throws if no classifier was injected", async () => {
    const reg = new SkillRegistry(skills);
    await expect(reg.match("brainstorm")).rejects.toThrow(/classifier/i);
  });
});
