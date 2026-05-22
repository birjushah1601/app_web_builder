import { z } from "zod";

export const CRITIQUE_SYSTEM_PROMPT = `You are reviewing a SchemaProposal from the Schema Architect for distinctness (are the 3 directions architecturally different?) and brief-alignment (does the recommended direction match what the user asked for?).

Score each on a 0-10 scale. Cite specific entities or operations as evidence. Return via the emit_critique tool.`;

export const CritiqueSchema = z.object({
  distinctness: z.number().int().min(0).max(10),
  briefAlignment: z.number().int().min(0).max(10),
  issues: z.array(z.string())
});
export type Critique = z.infer<typeof CritiqueSchema>;

export const CRITIQUE_TOOL_SCHEMA = {
  type: "object",
  properties: {
    distinctness: { type: "number" },
    briefAlignment: { type: "number" },
    issues: { type: "array", items: { type: "string" } }
  },
  required: ["distinctness", "briefAlignment", "issues"]
} as const;
