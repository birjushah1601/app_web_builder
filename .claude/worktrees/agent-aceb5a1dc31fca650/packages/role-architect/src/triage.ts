import type { LLMMessage, LLMProvider } from "@atlas/llm-provider";
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
  const messages: LLMMessage[] = [
    { role: "system", content: TRIAGE_SYSTEM_PROMPT, cache_control: { type: "ephemeral" } },
    { role: "system", content: `<graph-slice hash="${input.graphSlice.hash}">\n${input.graphSlice.bytes}\n</graph-slice>` },
    { role: "user", content: input.userTurn }
  ];

  let result;
  try {
    result = await (input.llm as unknown as {
      completeWithToolUse: (m: LLMMessage[], o: Record<string, unknown>) => Promise<{ toolName: string; input: unknown }>;
    }).completeWithToolUse(messages, {
      model,
      maxTokens: 4096,
      tools: [
        {
          name: "emit_ambiguity_report",
          description: "Emit the triage result with scope + questions",
          input_schema: AMBIGUITY_TOOL_SCHEMA
        }
      ],
      toolChoice: { type: "tool", name: "emit_ambiguity_report" }
    });
  } catch (err) {
    // Preserve the cause's message inline so consumers (Conductor's
    // role.failed payload, RitualEscalatedError) that only forward
    // .message still see *what* failed, not just *that* triage failed.
    const causeMsg = err instanceof Error ? err.message : String(err);
    throw new TriageFailedError(`triage LLM call failed: ${causeMsg}`, { cause: err });
  }

  const parse = AmbiguityReportSchema.safeParse(result.input);
  if (!parse.success) {
    throw new TriageFailedError(
      `triage tool_use payload failed AmbiguityReportSchema: ${parse.error.message}`,
      { cause: parse.error }
    );
  }
  return parse.data;
}
