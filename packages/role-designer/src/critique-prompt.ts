import { z } from "zod";
import type { InspirationBrief } from "@atlas/role-researcher";

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

/**
 * Build the critique user-turn message.
 *
 * Leads with category-specific patternsThatWin / patternsThatLose so the
 * critique LLM scores the draft against actual category signals before
 * falling back to generic SaaS conventions.
 */
export function renderCritiqueUserTurn(brief: InspirationBrief, draft: unknown): string {
  const wins = (brief.patternsThatWin ?? []).map((p) => `  - ${p}`).join("\n");
  const loses = (brief.patternsThatLose ?? []).map((p) => `  - ${p}`).join("\n");

  return [
    `You are critiquing a design proposal for a website in the category: ${brief.category}.`,
    ``,
    `Patterns that MUST appear in winning designs for this category:`,
    wins || "  (no category patterns supplied — score using general design heuristics)",
    ``,
    `Patterns that MUST NOT appear (these signal a regression to generic SaaS):`,
    loses || "  (no anti-patterns supplied)",
    ``,
    `Score the draft against THESE category-specific patterns. Generic SaaS or landing-page conventions don't apply unless the category IS SaaS or generic-landing.`,
    ``,
    `## Draft proposal`,
    JSON.stringify(draft, null, 2),
    ``,
    `## Rubric — score each axis 1-5 with a specific suggestion if score < 5`,
    `1. palette — distinctness from category defaults; coherence with token typography`,
    `2. typography — fitness for category; hierarchy clarity`,
    `3. composition — section variety; spacing rhythm; matches layoutDirective intent`,
    `4. patterns_alignment — does the proposal honor patternsThatWin? does it avoid patternsThatLose?`,
    `5. distinctness — would two restaurants both get this same proposal? if yes, score low.`
  ].join("\n");
}
