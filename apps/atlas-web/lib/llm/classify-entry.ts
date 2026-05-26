import type { LLMProvider } from "@atlas/llm-provider";

export interface ClassifyEntryInput {
  prompt: string;
  artifactKindHint?: string;
}

export interface ClassifyEntryResult {
  mode: "single-ritual" | "workflow";
  suggestedKinds?: string[];
  reasoning: string;
}

const SYSTEM_PROMPT = `You are the Atlas entry classifier.
Decide whether a prompt should be built as a single ritual (one artifact, today's flow)
or as a workflow (multiple coordinated artifacts: backend, frontend, tests, infra, deploy).

Single-ritual signals: "landing page", "marketing site", "hero section", "about page",
"one-page", "CLI tool", "mobile app" (if scoped to one platform), "data pipeline" (if standalone).

Workflow signals: words implying multiple tiers/services — "SaaS", "platform", "users",
"login", "signup", "billing", "subscription", "dashboard", "admin panel", "API + frontend",
"backend with web client", "database", "uploads + accounts", multi-feature apps.

If artifactKindHint is set (the user explicitly chose a single artifact kind), default to
single-ritual unless the prompt clearly implies multi-artifact.`;

const TOOL_SCHEMA = {
  type: "object",
  properties: {
    mode: { type: "string", enum: ["single-ritual", "workflow"] },
    suggestedKinds: {
      type: "array",
      items: {
        type: "string",
        enum: [
          "frontend-app",
          "backend-rest-api",
          "backend-graphql",
          "tests",
          "iac",
          "deploy",
          "data-pipeline",
          "mobile-app",
          "cli-tool"
        ]
      }
    },
    reasoning: { type: "string" }
  },
  required: ["mode", "reasoning"]
} as const;

export async function classifyEntry(
  input: ClassifyEntryInput,
  llm: LLMProvider
): Promise<ClassifyEntryResult> {
  const llmAny = llm as unknown as {
    completeWithToolUse: (
      messages: unknown[],
      options: unknown
    ) => Promise<{ input: ClassifyEntryResult }>;
  };

  const userTurn = input.artifactKindHint
    ? `Prompt: """${input.prompt}"""\n\nUser explicitly picked artifactKind: ${input.artifactKindHint}.`
    : `Prompt: """${input.prompt}"""`;

  const result = await llmAny.completeWithToolUse(
    [
      { role: "system", content: SYSTEM_PROMPT },
      { role: "user", content: userTurn }
    ],
    {
      model: process.env.ATLAS_LLM_TRIAGE_MODEL ?? "google/gemini-2.5-flash",
      maxTokens: 1024,
      tools: [
        {
          name: "classify",
          description: "Emit classification",
          input_schema: TOOL_SCHEMA
        }
      ],
      toolChoice: { type: "tool", name: "classify" }
    }
  );

  return result.input;
}
