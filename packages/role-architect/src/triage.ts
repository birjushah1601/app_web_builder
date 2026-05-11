import type { LLMMessage, LLMProvider } from "@atlas/llm-provider";
import { AmbiguityReportSchema, type AmbiguityReport } from "./types.js";
import { TriageFailedError } from "./errors.js";

// OpenRouter-format default — anthropic/claude-haiku-4.5. Operators can
// override via ATLAS_LLM_TRIAGE_MODEL; atlas-web's engine factory passes
// the env-resolved value through `triageModel` on TriageInput.
export const ARCHITECT_TRIAGE_MODEL =
  process.env.ATLAS_LLM_TRIAGE_MODEL ?? "anthropic/claude-haiku-4.5";

export interface TriageInput {
  userTurn: string;
  graphSlice: { bytes: string; hash: string };
  llm: LLMProvider;
  triageModel?: string;
}

const TRIAGE_SYSTEM_PROMPT = `You are the Architect's triage pass. Classify the user's request into one of:
new-app, new-feature, bug-fix, dep-upgrade, refactor, ship, migrate.

## Default to passing.

For prototype-tier scopes (new-app, new-feature, refactor), set passed=true and use these
sane defaults instead of asking blocker questions:
  - compliance class: "none" (general-purpose web app, no PII/regulated data)
  - data residency: operator's default region (no special requirements)
  - auth provider: assume the project's existing auth (or "none" if greenfield)
  - DB provider: Postgres
  - payments: skip integration until the user explicitly asks for checkout flows

ONLY mark a question as severity="blocker" when the user's prompt EXPLICITLY mentions
regulated data (HIPAA, PCI, GDPR, SOC2), live payments, multi-tenant isolation, or
a constraint that conflicts with the defaults above. If unsure, prefer
severity="recommended" — the user can refine later.

This gate is meant to catch genuine architectural ambiguity, not interrogate the user
on a hello-world page. Default to forward motion.

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
