import type { LLMProvider } from "@atlas/llm-provider";
import { AmbiguityReportSchema, type AmbiguityReport } from "./types.js";
import { TriageFailedError } from "./errors.js";

export const ARCHITECT_TRIAGE_MODEL = "claude-haiku-4-5-20251001";

export interface TriageInput {
  userTurn: string;
  graphSlice: { bytes: string; hash: string };
  llm: LLMProvider;
  triageModel?: string;
}

const TRIAGE_SYSTEM_PROMPT = `You are the Architect's triage pass. Classify the user's request into one of:
new-app, new-feature, bug-fix, dep-upgrade, refactor, ship, migrate.

Identify ambiguities that would block a deep plan. A "blocker" is missing information
the Architect cannot safely infer: compliance class, data-residency region, auth provider,
DB provider, payment regions. "Recommended" questions can be answered later.

Call the emit_ambiguity_report tool exactly once with your findings.`;

const AMBIGUITY_TOOL_SCHEMA = {
  type: "object",
  properties: {
    passed: {
      type: "boolean",
      description: "true if no blocker-severity questions are present"
    },
    scope: {
      type: "string",
      enum: ["new-app", "new-feature", "bug-fix", "dep-upgrade", "refactor", "ship", "migrate"]
    },
    questions: {
      type: "array",
      items: {
        type: "object",
        properties: {
          question: { type: "string" },
          reason: { type: "string" },
          severity: { type: "string", enum: ["blocker", "recommended"] }
        },
        required: ["question", "reason", "severity"]
      }
    }
  },
  required: ["passed", "scope", "questions"]
} as const;

export async function triage(input: TriageInput): Promise<AmbiguityReport> {
  const model = input.triageModel ?? ARCHITECT_TRIAGE_MODEL;

  // D.2 pragmatic cast: AnthropicProvider wraps the Anthropic SDK, but its public
  // complete() method only returns flattened text blocks. Tool-use responses carry
  // content blocks of type "tool_use" which parseResponse() silently discards.
  // T6 will add completeWithToolUse() to LLMProvider. Until then we reach through
  // to the SDK's messages.create via a structural cast on the provider's private sdk.
  const rawProvider = input.llm as unknown as {
    sdk: {
      messages: {
        create: (body: Record<string, unknown>) => Promise<{
          content: Array<{ type: string; name?: string; input?: unknown }>;
          model: string;
          stop_reason: string;
          usage: { input_tokens: number; output_tokens: number };
        }>;
      };
    };
  };

  const system = [
    {
      type: "text" as const,
      text: TRIAGE_SYSTEM_PROMPT,
      cache_control: { type: "ephemeral" as const }
    },
    {
      type: "text" as const,
      text: `<graph-slice hash="${input.graphSlice.hash}">\n${input.graphSlice.bytes}\n</graph-slice>`
    }
  ];

  const resp = await rawProvider.sdk.messages.create({
    model,
    max_tokens: 4096,
    system,
    messages: [{ role: "user", content: input.userTurn }],
    tools: [
      {
        name: "emit_ambiguity_report",
        description: "Emit the triage result with scope + questions",
        input_schema: AMBIGUITY_TOOL_SCHEMA
      }
    ],
    tool_choice: { type: "tool", name: "emit_ambiguity_report" }
  });

  const toolUse = resp.content.find(
    (c) => c.type === "tool_use" && c.name === "emit_ambiguity_report"
  );
  if (!toolUse || toolUse.input === undefined) {
    throw new TriageFailedError(
      "triage response did not include an emit_ambiguity_report tool_use block"
    );
  }

  const parse = AmbiguityReportSchema.safeParse(toolUse.input);
  if (!parse.success) {
    throw new TriageFailedError("triage tool_use payload failed AmbiguityReportSchema", {
      cause: parse.error
    });
  }
  return parse.data;
}
