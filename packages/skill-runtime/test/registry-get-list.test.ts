import path from "node:path";
import { describe, expect, it } from "vitest";
import { loadSkillsFromDir } from "../src/loader.js";
import { SkillRegistry } from "../src/registry.js";

const FIXTURES_DIR = path.resolve(import.meta.dirname, "fixtures/skills");

function makeRegistry(): SkillRegistry {
  const skills = loadSkillsFromDir(FIXTURES_DIR);
  return new SkillRegistry(skills);
}

describe("SkillRegistry.get", () => {
  it("returns a skill by exact name", () => {
    const reg = makeRegistry();
    const skill = reg.get("brainstorm");
    expect(skill).toBeDefined();
    expect(skill!.frontmatter.name).toBe("brainstorm");
  });

  it("returns undefined for an unknown name", () => {
    const reg = makeRegistry();
    expect(reg.get("nonexistent-skill")).toBeUndefined();
  });
});

describe("SkillRegistry.list", () => {
  it("returns all loaded skills", () => {
    const reg = makeRegistry();
    const list = reg.list();
    expect(list.length).toBeGreaterThanOrEqual(5); // brainstorm + tdd-feature + compose-a/b/c
    expect(list.map((s) => s.frontmatter.name)).toContain("brainstorm");
  });

  it("returns a copy — mutating the result does not affect the registry", () => {
    const reg = makeRegistry();
    const list = reg.list();
    list.splice(0, list.length);
    expect(reg.list().length).toBeGreaterThanOrEqual(5);
  });
});
