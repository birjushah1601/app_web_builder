import { describe, it, expect } from "vitest";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { createRegistryWithOverrides, loadSkillsFromDir } from "@atlas/skill-runtime";
import { assembleSecurityPrompt } from "../src/assemble-prompt.js";
import { SkillMissingError } from "../src/errors.js";

const here = dirname(fileURLToPath(import.meta.url));
const fixtureDir = join(here, "fixtures", "skills");

describe("assembleSecurityPrompt", () => {
  it("concatenates the four required skill bodies with section separators", () => {
    const skills = loadSkillsFromDir(fixtureDir);
    const registry = createRegistryWithOverrides(skills, []);
    const prompt = assembleSecurityPrompt(registry, ["audit-rls", "cors-policy", "secrets-scan", "cve-check"]);
    expect(prompt).toContain("## Skill: audit-rls");
    expect(prompt).toContain("## Skill: cors-policy");
    expect(prompt).toContain("## Skill: secrets-scan");
    expect(prompt).toContain("## Skill: cve-check");
    expect(prompt).toContain("rlsPolicies");
    expect(prompt).toContain("allowedOrigins");
    expect(prompt).toContain("hardcoded secrets");
    expect(prompt).toContain("CVE");
    // Order must match requested order
    const idx = (s: string) => prompt.indexOf(s);
    expect(idx("## Skill: audit-rls")).toBeLessThan(idx("## Skill: cors-policy"));
    expect(idx("## Skill: cors-policy")).toBeLessThan(idx("## Skill: secrets-scan"));
    expect(idx("## Skill: secrets-scan")).toBeLessThan(idx("## Skill: cve-check"));
  });

  it("throws SkillMissingError when a required skill is absent", () => {
    const skills = loadSkillsFromDir(fixtureDir).filter((s) => s.frontmatter.name !== "audit-rls");
    const registry = createRegistryWithOverrides(skills, []);
    expect(() => assembleSecurityPrompt(registry, ["audit-rls", "cors-policy", "secrets-scan", "cve-check"]))
      .toThrow(SkillMissingError);
  });
});
