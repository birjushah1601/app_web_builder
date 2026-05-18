import type { LLMMessage } from "@atlas/llm-provider";

export interface PromptCacheInput {
  rolePrompt: string;
  graphSlice: { bytes: string; hash: string };
  userTurn: string;
}

export function buildPromptCacheBlocks(input: PromptCacheInput): LLMMessage[] {
  return [
    {
      role: "system",
      content: input.rolePrompt,
      cache_control: { type: "ephemeral" }
    },
    {
      role: "system",
      content: `<graph-slice hash="${input.graphSlice.hash}">\n${input.graphSlice.bytes}\n</graph-slice>`,
      cache_control: { type: "ephemeral" }
    },
    {
      role: "user",
      content: input.userTurn
    }
  ];
}
