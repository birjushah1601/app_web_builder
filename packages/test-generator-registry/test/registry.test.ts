import { describe, it, expect } from "vitest";
import { SkillRegistry } from "@atlas/skill-runtime";
import type { Skill } from "@atlas/skill-runtime";
import { TestGeneratorRegistry } from "../src/registry.js";
import { NoGeneratorForKindError } from "../src/errors.js";

const makeSkill = (name: string, activateOn: string): Skill => ({
  frontmatter: {
    name,
    description: "d",
    activate_on: [activateOn]
  },
  body: `# ${name}\nBody for ${name}`,
  sourcePath: `/fake/${name}.md`
});

describe("TestGeneratorRegistry", () => {
  it("indexes skills with activate_on: node:<kind>", () => {
    const skills = [
      makeSkill("gen-test-page", "node:page"),
      makeSkill("gen-test-component", "node:component"),
      makeSkill("skill-other", "merge-gate.a11y")
    ];
    const skillReg = new SkillRegistry(skills);
    const reg = TestGeneratorRegistry.fromSkillRegistry(skillReg);
    expect(reg.generatorFor("page")?.frontmatter.name).toBe("gen-test-page");
    expect(reg.generatorFor("component")?.frontmatter.name).toBe("gen-test-component");
  });

  it("returns undefined for kinds with no generator", () => {
    const skillReg = new SkillRegistry([makeSkill("gen-test-page", "node:page")]);
    const reg = TestGeneratorRegistry.fromSkillRegistry(skillReg);
    expect(reg.generatorFor("flow")).toBeUndefined();
  });

  it("lists all indexed kinds", () => {
    const skills = [
      makeSkill("gen-test-page", "node:page"),
      makeSkill("gen-test-authboundary", "node:authboundary")
    ];
    const reg = TestGeneratorRegistry.fromSkillRegistry(new SkillRegistry(skills));
    expect(reg.kinds().sort()).toEqual(["authboundary", "page"]);
  });

  it("requireGeneratorFor throws NoGeneratorForKindError for missing kind", () => {
    const reg = TestGeneratorRegistry.fromSkillRegistry(new SkillRegistry([]));
    expect(() => reg.requireGeneratorFor("page")).toThrow(NoGeneratorForKindError);
  });
});
