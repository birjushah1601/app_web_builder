import type { LLMMessage, LLMProvider } from "@atlas/llm-provider";
import type { SkillRegistry } from "@atlas/skill-runtime";
import { assembleDeveloperPrompt } from "./assemble-prompt.js";
import { DeveloperOutputSchema, type DeveloperOutput } from "./types.js";

export const DEVELOPER_ANTHROPIC_MODEL = "claude-sonnet-4-6";

const DEVELOPER_TOOL_SCHEMA = {
  type: "object",
  properties: {
    diff: { type: "string" },
    summary: { type: "string" },
    testsAdded: { type: "array", items: { type: "string" } },
    filesModified: { type: "array", items: { type: "string" } }
  },
  required: ["diff", "summary", "testsAdded", "filesModified"]
} as const;

export interface AnthropicPassInput {
  llm: LLMProvider;
  skills: SkillRegistry;
  userTurn: string;
  architectArtifact: unknown;
  graphSlice: { bytes: string; hash: string };
  model?: string;
}

export async function anthropicPass(input: AnthropicPassInput): Promise<DeveloperOutput> {
  const skillPrompt = assembleDeveloperPrompt(input.skills, ["tdd-feature", "edit-only-what-changed", "runnable-plan"]);
  const systemPrompt = `You are the Atlas Developer (Anthropic Sonnet pass). Generate a unified diff that implements the Architect's runnable plan.\n\n${skillPrompt}`;
  const messages: LLMMessage[] = [
    { role: "system", content: systemPrompt, cache_control: { type: "ephemeral" } },
    { role: "system", content: `<graph-slice hash="${input.graphSlice.hash}">\n${input.graphSlice.bytes}\n</graph-slice>` },
    { role: "user", content: `User intent: ${input.userTurn}\n\nArchitect artifact:\n${JSON.stringify(input.architectArtifact, null, 2)}` }
  ];
  const result = await (input.llm as unknown as {
    completeWithToolUse: (m: LLMMessage[], o: Record<string, unknown>) => Promise<{ toolName: string; input: unknown }>;
  }).completeWithToolUse(messages, {
    model: input.model ?? DEVELOPER_ANTHROPIC_MODEL,
    maxTokens: 8192,
    tools: [{ name: "emit_developer_output", description: "Emit the diff + summary + tests", input_schema: DEVELOPER_TOOL_SCHEMA }],
    toolChoice: { type: "tool", name: "emit_developer_output" }
  });
  return DeveloperOutputSchema.parse(result.input);
}
