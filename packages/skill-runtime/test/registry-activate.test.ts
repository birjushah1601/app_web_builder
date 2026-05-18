import { z } from "zod";
import { describe, expect, it } from "vitest";
import { SkillRegistry } from "../src/registry.js";
import type { Skill } from "../src/skill.js";

function makeSkillWithInputs(inputsSchema: z.ZodTypeAny): Skill {
  return {
    frontmatter: {
      name: "typed-skill",
      description: "A skill with typed inputs",
      activate_on: ["typed-skill"],
      inputs: inputsSchema
    },
    body: "# Typed Skill\n\nBody text.",
    sourcePath: "/virtual/typed-skill.md"
  };
}

describe("SkillRegistry.activate", () => {
  const inputsSchema = z.object({ prompt: z.string().min(1), count: z.number().int().positive() });
  const skill = makeSkillWithInputs(inputsSchema);
  const reg = new SkillRegistry([skill]);

  it("returns an ActivationRecord for valid inputs", () => {
    const record = reg.activate("typed-skill", { prompt: "hello", count: 3 });
    expect(record.skillName).toBe("typed-skill");
    expect(record.validatedInputs).toEqual({ prompt: "hello", count: 3 });
    expect(record.body).toContain("Body text.");
    expect(record.activatedAt).toBeInstanceOf(Date);
  });

  it("throws SkillNotFoundError for an unknown skill name", () => {
    expect(() => reg.activate("ghost", {})).toThrow(/SkillNotFoundError|not found/i);
  });

  it("throws SkillInputValidationError when inputs fail the schema", () => {
    expect(() =>
      reg.activate("typed-skill", { prompt: "", count: -1 })
    ).toThrow(/SkillInputValidationError|invalid/i);
  });

  it("returns an ActivationRecord with validatedInputs=null for a skill with no inputs schema", () => {
    const noInputsSkill: Skill = {
      frontmatter: { name: "no-inputs", description: "x", activate_on: ["x"] },
      body: "# No Inputs",
      sourcePath: "/virtual/no-inputs.md"
    };
    const noInputsReg = new SkillRegistry([noInputsSkill]);
    const record = noInputsReg.activate("no-inputs", {});
    expect(record.validatedInputs).toBeNull();
  });

  it("throws SkillInputValidationError with structured Zod issues on the error object", () => {
    try {
      reg.activate("typed-skill", { prompt: "", count: "not-a-number" });
    } catch (err) {
      expect(err).toBeInstanceOf(Error);
      expect((err as Error).message).toMatch(/SkillInputValidationError/);
      // The error carries Zod issues
      expect((err as { issues?: unknown[] }).issues).toBeDefined();
    }
  });
});
