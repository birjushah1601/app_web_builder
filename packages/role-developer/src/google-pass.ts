import type { LLMMessage, LLMProvider } from "@atlas/llm-provider";
import type { SkillRegistry } from "@atlas/skill-runtime";
import { assembleDeveloperPrompt, SANDBOX_CONTEXT_PROMPT } from "./assemble-prompt.js";
import { withDefaults } from "./anthropic-pass.js";
import { DeveloperOutputSchema, type DeveloperOutput } from "./types.js";

export const DEVELOPER_GOOGLE_MODEL = "gemini-2.5-flash";

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

export interface GooglePassInput {
  llm: LLMProvider;
  skills: SkillRegistry;
  userTurn: string;
  architectArtifact: unknown;
  graphSlice: { bytes: string; hash: string };
  model?: string;
}

export async function googlePass(input: GooglePassInput): Promise<DeveloperOutput> {
  const skillPrompt = assembleDeveloperPrompt(input.skills, ["tdd-feature", "edit-only-what-changed", "runnable-plan"]);
  const systemPrompt = `You are the Atlas Developer (Google Gemini pass). Generate a unified diff that implements the Architect's runnable plan.\n\n${SANDBOX_CONTEXT_PROMPT}\n${skillPrompt}`;
  const messages: LLMMessage[] = [
    { role: "system", content: systemPrompt },
    { role: "system", content: `<graph-slice hash="${input.graphSlice.hash}">\n${input.graphSlice.bytes}\n</graph-slice>` },
    { role: "user", content: `User intent: ${input.userTurn}\n\nArchitect artifact:\n${JSON.stringify(input.architectArtifact, null, 2)}` }
  ];
  const result = await (input.llm as unknown as {
    completeWithToolUse: (m: LLMMessage[], o: Record<string, unknown>) => Promise<{ toolName: string; input: unknown }>;
  }).completeWithToolUse(messages, {
    model: input.model ?? DEVELOPER_GOOGLE_MODEL,
    // See anthropic-pass for rationale: 8192 truncates mid-file on full-page
    // diffs. 32k gives full-page-plus-CSS headroom without hitting the cap.
    maxTokens: 32_000,
    tools: [{ name: "emit_developer_output", description: "Emit the diff + summary + tests", input_schema: DEVELOPER_TOOL_SCHEMA }],
    toolChoice: { type: "tool", name: "emit_developer_output" }
  });
  // Same defensive defaults as anthropicPass — see withDefaults() in
  // anthropic-pass.ts for the rationale.
  return DeveloperOutputSchema.parse(withDefaults(result.input));
}
