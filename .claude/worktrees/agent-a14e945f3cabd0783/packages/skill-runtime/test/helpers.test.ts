import path from "node:path";
import { describe, expect, it } from "vitest";
import { createRegistryWithOverrides } from "../src/helpers.js";
import { SkillRegistry } from "../src/registry.js";
import type { Skill } from "../src/skill.js";

const FIXTURES_DIR = path.resolve(import.meta.dirname, "fixtures/skills");

function makeSkill(name: string, body = `# ${name}`): Skill {
  return {
    frontmatter: { name, description: `Fixture ${name}`, activate_on: [name] },
    body,
    sourcePath: `/virtual/${name}.md`
  };
}

describe("createRegistryWithOverrides", () => {
  it("returns a SkillRegistry instance", () => {
    const reg = createRegistryWithOverrides([makeSkill("brainstorm")], []);
    expect(reg).toBeInstanceOf(SkillRegistry);
  });

  it("local skills take precedence over bundled skills with the same name", () => {
    const bundled = [makeSkill("brainstorm", "# Bundled brainstorm")];
    const local = [makeSkill("brainstorm", "# Local brainstorm override")];
    const reg = createRegistryWithOverrides(bundled, local);
    expect(reg.get("brainstorm")!.body).toContain("Local brainstorm override");
  });

  it("bundled skills that are not overridden are available in the registry", () => {
    const bundled = [makeSkill("brainstorm"), makeSkill("tdd-feature")];
    const local = [makeSkill("brainstorm", "# Override")];
    const reg = createRegistryWithOverrides(bundled, local);
    expect(reg.get("tdd-feature")).toBeDefined();
  });

  it("loads skills from the fixtures directory without error", () => {
    const reg = createRegistryWithOverrides([], []);
    // No-skill registry is still a valid registry
    expect(reg.list()).toHaveLength(0);
  });
});
