export const REVISE_SYSTEM_PROMPT = `You revised a SchemaProposal in light of a critique. Address each issue from the critique by editing entities/operations in the proposal. Return a revised SchemaProposal via emit_revised_schema_proposal.

Do NOT change unaffected parts of the proposal — keep them byte-identical so the user's mental model stays stable.`;

export const REVISED_PROPOSAL_TOOL_SCHEMA = {
  type: "object",
  properties: {
    recommended: { type: "object" },
    alternates: { type: "array", minItems: 2, maxItems: 2 },
    reasoning: { type: "string" }
  },
  required: ["recommended", "alternates", "reasoning"]
} as const;
