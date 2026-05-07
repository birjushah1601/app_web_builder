import { describe, it, expect } from "vitest";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { createRegistryWithOverrides, loadSkillsFromDir } from "@atlas/skill-runtime";
import { assembleDeveloperPrompt, SANDBOX_CONTEXT_PROMPT } from "../src/assemble-prompt.js";
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

describe("SANDBOX_CONTEXT_PROMPT", () => {
  it("describes Tailwind as available (positive list)", () => {
    expect(SANDBOX_CONTEXT_PROMPT).toMatch(/Tailwind/i);
    expect(SANDBOX_CONTEXT_PROMPT).not.toMatch(/NO Tailwind/i);
  });

  it("describes shadcn/ui as available", () => {
    expect(SANDBOX_CONTEXT_PROMPT).toMatch(/shadcn/i);
  });

  it("describes lucide-react as available for icons", () => {
    expect(SANDBOX_CONTEXT_PROMPT).toMatch(/lucide-react/);
    expect(SANDBOX_CONTEXT_PROMPT).not.toMatch(/NO lucide-react/i);
  });

  it("describes framer-motion as available for animation", () => {
    expect(SANDBOX_CONTEXT_PROMPT).toMatch(/framer-motion/);
    expect(SANDBOX_CONTEXT_PROMPT).not.toMatch(/NO framer-motion/i);
  });

  it("retains the diff-format contract (CRITICAL section)", () => {
    expect(SANDBOX_CONTEXT_PROMPT).toMatch(/Diff format \(CRITICAL\)/);
    expect(SANDBOX_CONTEXT_PROMPT).toMatch(/--- \/dev\/null/);
  });

  it("warns against creating top-level index.html", () => {
    expect(SANDBOX_CONTEXT_PROMPT).toMatch(/Do.*NOT.*index\.html/i);
  });

  it("guides toward shadcn over inline styles", () => {
    expect(SANDBOX_CONTEXT_PROMPT).toMatch(/@\/components\/ui/);
  });

  it("explains design-token CSS variables", () => {
    expect(SANDBOX_CONTEXT_PROMPT).toMatch(/--atlas-/);
  });
});
