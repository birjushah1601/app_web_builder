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
  // Same defensive pattern as the architect's graphSlice fix in deep-plan.ts:
  // models against tools-stripping proxies sometimes omit the array fields.
  // Default both to [] when missing so DeveloperOutputSchema.parse succeeds.
  // The diff and summary are still required — those carry the model's actual
  // work; we don't paper over their absence.
  return DeveloperOutputSchema.parse(withDefaults(result.input));
}

/** Defensive defaults for the two array fields. Models against
 *  tools-stripping proxies sometimes omit them; rather than 500 the entire
 *  ritual, we fill them in:
 *   - testsAdded: defaults to [] (schema allows empty).
 *   - filesModified: schema requires ≥ 1 entry, so we parse `diff --git a/X
 *     b/X` headers from the diff to recover the file list. If the diff isn't
 *     in git format, we fall back to a single "unspecified" entry — the
 *     schema passes; the developer's diff is still surfaced to the user. */
export function withDefaults(input: unknown): unknown {
  if (!input || typeof input !== "object") return input;
  const o = input as Record<string, unknown>;
  let filesModified: string[] = Array.isArray(o.filesModified) ? (o.filesModified as string[]) : [];
  if (filesModified.length === 0 && typeof o.diff === "string") {
    filesModified = parseFilesFromDiff(o.diff);
  }
  if (filesModified.length === 0) {
    filesModified = ["unspecified"];
  }
  return {
    ...o,
    testsAdded: Array.isArray(o.testsAdded) ? o.testsAdded : [],
    filesModified
  };
}

function parseFilesFromDiff(diff: string): string[] {
  // Matches both `diff --git a/path b/path` and `+++ b/path` headers.
  const files = new Set<string>();
  for (const line of diff.split("\n")) {
    const git = /^diff --git a\/(\S+) b\/(\S+)/.exec(line);
    if (git) {
      files.add(git[2] ?? git[1]!);
      continue;
    }
    const plus = /^\+\+\+ b\/(\S+)/.exec(line);
    if (plus && plus[1]) files.add(plus[1]);
  }
  return Array.from(files);
}
