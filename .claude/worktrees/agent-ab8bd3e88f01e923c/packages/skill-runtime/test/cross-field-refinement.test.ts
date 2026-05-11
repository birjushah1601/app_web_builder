import { z } from "zod";
import { describe, expect, it } from "vitest";
import { SkillRegistry } from "../src/registry.js";
import type { Skill } from "../src/skill.js";

/**
 * Demonstrates the OQ8-documented split-then-superRefine pattern.
 *
 * WRONG (fails at schema construction time in Zod v3):
 *   z.discriminatedUnion("mode", [...]).refine(rule)
 *   → ZodError: ZodEffects cannot be a member of a discriminated union
 *
 * CORRECT (B.1 AuthBoundary pattern):
 *   Build the discriminated union from base schemas (no refinements),
 *   then apply .superRefine at the top level.
 */
const StrictModeBaseSchema = z.object({ mode: z.literal("strict"), threshold: z.number().optional() });
const PermissiveModeSchema = z.object({ mode: z.literal("permissive") });

const CrossFieldInputsSchema = z
  .discriminatedUnion("mode", [StrictModeBaseSchema, PermissiveModeSchema])
  .superRefine((val, ctx) => {
    if (val.mode === "strict" && (val.threshold === undefined || val.threshold <= 0)) {
      ctx.addIssue({
        code: "custom",
        path: ["threshold"],
        message: 'threshold must be a positive number when mode is "strict"'
      });
    }
  });

function makeCrossFieldSkill(): Skill {
  return {
    frontmatter: {
      name: "cross-field",
      description: "Cross-field fixture",
      activate_on: ["cross-field"],
      inputs: CrossFieldInputsSchema
    },
    body: "# Cross-Field",
    sourcePath: "/virtual/cross-field.md"
  };
}

describe("cross-field refinement pattern (OQ8)", () => {
  const reg = new SkillRegistry([makeCrossFieldSkill()]);

  it("accepts strict mode with a positive threshold", () => {
    const record = reg.activate("cross-field", { mode: "strict", threshold: 0.5 });
    expect((record.validatedInputs as { mode: string }).mode).toBe("strict");
  });

  it("rejects strict mode with no threshold (cross-field rule)", () => {
    expect(() => reg.activate("cross-field", { mode: "strict" })).toThrow(/SkillInputValidationError/);
  });

  it("rejects strict mode with threshold <= 0 (cross-field rule)", () => {
    expect(() => reg.activate("cross-field", { mode: "strict", threshold: 0 })).toThrow(/SkillInputValidationError/);
  });

  it("accepts permissive mode with no threshold (cross-field rule does not apply)", () => {
    const record = reg.activate("cross-field", { mode: "permissive" });
    expect((record.validatedInputs as { mode: string }).mode).toBe("permissive");
  });

  it("schema construction itself does not throw (discriminatedUnion + superRefine is safe)", () => {
    expect(() => CrossFieldInputsSchema.parse({ mode: "permissive" })).not.toThrow();
  });
});
