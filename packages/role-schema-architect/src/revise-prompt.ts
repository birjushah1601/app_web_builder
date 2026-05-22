import { PROPOSAL_TOOL_SCHEMA } from "./assemble-proposal.js";

export const REVISE_SYSTEM_PROMPT = `You are revising a SchemaProposal in light of a critique. Address each issue the critique surfaces by editing the relevant entities or operations in the proposal. Return the revised SchemaProposal via the emit_revised_schema_proposal tool.

Preserve the id, name, shortDescription, and technicalDescription of directions you are NOT revising — only modify entities, fields, operations, or RLS policies where the critique identifies issues. The same 10 hard rules from the original system prompt still apply to the revised output.`;

// Reuse the proposal tool schema verbatim — the revise pass MUST return a full
// SchemaProposal, not a stub. Earlier scaffold used { recommended: { type:
// "object" } } which gave the LLM no structural guidance and resulted in
// nearly-guaranteed schema-mismatch errors at parse time.
export const REVISED_PROPOSAL_TOOL_SCHEMA = PROPOSAL_TOOL_SCHEMA;
