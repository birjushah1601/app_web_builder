export const REVISE_SYSTEM_PROMPT = `You are the Designer's revise pass. You have a draft proposal and a critique. Revise the proposal to address every suggestion. Output the same shape (recommended + alternates + reasoning) via the emit_revised_proposal tool. Keep ID stable when possible; bump palette/typography per the critique. Do not invent new alternates — refine the existing ones.`;

// Tool schema is identical to emit_proposal's — reuse it.
export { PROPOSAL_TOOL_SCHEMA as REVISED_PROPOSAL_TOOL_SCHEMA } from "./assemble-proposal.js";
