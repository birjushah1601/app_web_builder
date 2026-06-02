import type { LLMMessage, LLMProvider, LLMUsage } from "@atlas/llm-provider";
import { ReviewerVoteSchema, type DeveloperOutput, type ReviewerVote } from "./types.js";
import { ReviewerFailedError } from "./errors.js";

/** Plan G.4 Task 3 — return usage alongside ReviewerVote so the caller can
 *  record per-role token usage tagged with roleId="developer". */
export interface ReviewerVoteResult {
  vote: ReviewerVote;
  usage: LLMUsage;
  model: string;
}

export const DEVELOPER_REVIEWER_MODEL = "claude-sonnet-4-6";

const REVIEWER_TOOL_SCHEMA = {
  type: "object",
  properties: {
    winner: { type: "string", enum: ["anthropic", "google"] },
    reasoning: { type: "string" }
  },
  required: ["winner", "reasoning"]
} as const;

export interface ReviewerInput {
  llm: LLMProvider;
  anthropicOutput: DeveloperOutput;
  googleOutput: DeveloperOutput;
  model?: string;
}

export async function reviewerVote(input: ReviewerInput): Promise<ReviewerVoteResult> {
  const messages: LLMMessage[] = [
    {
      role: "system",
      content: `You are the Atlas Reviewer. Two providers (Anthropic Sonnet, Google Gemini Flash) generated competing diffs for the same task. Pick the winner based on: (a) test coverage, (b) diff minimality, (c) adherence to the runnable plan, (d) edit-only-what-changed discipline. Use the emit_reviewer_vote tool exactly once.`
    },
    {
      role: "user",
      content: `=== Anthropic output ===\n${JSON.stringify(input.anthropicOutput, null, 2)}\n\n=== Google output ===\n${JSON.stringify(input.googleOutput, null, 2)}`
    }
  ];
  const model = input.model ?? DEVELOPER_REVIEWER_MODEL;
  let result;
  try {
    result = await (input.llm as unknown as {
      completeWithToolUse: (m: LLMMessage[], o: Record<string, unknown>) => Promise<{ toolName: string; input: unknown; usage: LLMUsage }>;
    }).completeWithToolUse(messages, {
      model,
      maxTokens: 1024,
      tools: [{ name: "emit_reviewer_vote", description: "Emit the winning provider + reasoning", input_schema: REVIEWER_TOOL_SCHEMA }],
      toolChoice: { type: "tool", name: "emit_reviewer_vote" }
    });
  } catch (err) {
    throw new ReviewerFailedError("reviewer LLM call failed", { cause: err });
  }
  const parse = ReviewerVoteSchema.safeParse(result.input);
  if (!parse.success) throw new ReviewerFailedError("reviewer tool_use payload failed schema", { cause: parse.error });
  return { vote: parse.data, usage: result.usage, model };
}
