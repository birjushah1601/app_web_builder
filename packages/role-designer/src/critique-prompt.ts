import { z } from "zod";

export const CritiqueFindingSchema = z.object({
  axis: z.enum(["palette", "typography", "composition", "patterns_alignment", "distinctness"]),
  score: z.number().min(1).max(5),
  suggestion: z.string().min(1)
});
export const CritiqueSchema = z.object({
  findings: z.array(CritiqueFindingSchema)
});
export type Critique = z.infer<typeof CritiqueSchema>;

export const CRITIQUE_TOOL_SCHEMA = {
  type: "object",
  properties: {
    findings: {
      type: "array",
      items: {
        type: "object",
        properties: {
          axis: { type: "string", enum: ["palette", "typography", "composition", "patterns_alignment", "distinctness"] },
          score: { type: "number", minimum: 1, maximum: 5 },
          suggestion: { type: "string" }
        },
        required: ["axis", "score", "suggestion"]
      }
    }
  },
  required: ["findings"]
} as const;

export const CRITIQUE_SYSTEM_PROMPT = `You are the Designer's critique pass. Given a draft proposal, score it 1-5 on each axis:
- palette: ambition, distinctness from generic shadcn (slate+blue)
- typography: serif vs sans appropriateness for the category
- composition: confident whitespace + hierarchy
- patterns_alignment: does it reflect the Researcher's patternsThatWin?
- distinctness: would two restaurants both get this same proposal?

For each axis scoring <=3, emit a concrete suggestion (one sentence, actionable). Call emit_critique once.`;
