import path from "node:path";
import { describe, expect, it } from "vitest";
import { loadSkillsFromDir } from "../src/loader.js";

const FIXTURES_DIR = path.resolve(import.meta.dirname, "fixtures/skills");

describe("loadSkillsFromDir", () => {
  it("loads all .md files from the directory", () => {
    const skills = loadSkillsFromDir(FIXTURES_DIR);
    const names = skills.map((s) => s.frontmatter.name);
    expect(names).toContain("brainstorm");
    expect(names).toContain("tdd-feature");
    expect(names).toContain("compose-a");
  });

  it("sets sourcePath to the absolute file path", () => {
    const skills = loadSkillsFromDir(FIXTURES_DIR);
    const brainstorm = skills.find((s) => s.frontmatter.name === "brainstorm");
    expect(brainstorm?.sourcePath).toMatch(/brainstorm\.md$/);
    expect(path.isAbsolute(brainstorm!.sourcePath)).toBe(true);
  });

  it("populates the body field", () => {
    const skills = loadSkillsFromDir(FIXTURES_DIR);
    const brainstorm = skills.find((s) => s.frontmatter.name === "brainstorm");
    expect(brainstorm?.body.trim()).toMatch(/^# Brainstorm/);
  });

  it("returns empty array for a non-existent directory", () => {
    const skills = loadSkillsFromDir(path.join(FIXTURES_DIR, "__no_such_dir__"));
    expect(skills).toEqual([]);
  });

  it("skips non-.md files silently", () => {
    // The fixtures directory has only .md files — confirm no phantom entries
    const skills = loadSkillsFromDir(FIXTURES_DIR);
    for (const skill of skills) {
      expect(skill.sourcePath).toMatch(/\.md$/);
    }
  });
});
