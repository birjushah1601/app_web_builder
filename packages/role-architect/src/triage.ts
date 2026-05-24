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

## Widget kind (Plan U — optional, declare when known)

For every blocker question you emit, ALSO declare a widgetKind so the UI can
render the right control:
  - "yes-no" — binary answer ("Should we include guest checkout?", "Do you
    have an existing user table?")
  - "single-select" — a finite list of named choices. Also emit \`options\`
    as an array of 2-6 short labels (each ≤ 120 chars). Examples: which
    payment provider (Stripe/Razorpay/PayPal), which auth (Clerk/Auth0/
    built-in), which DB (Postgres/MySQL/SQLite).
  - "text" — open-ended free-form answer needed (audience cues, naming
    decisions, custom domain values). Default when neither yes-no nor
    single-select fits.

Set widgetKind ONLY when you're confident the answer shape fits. When in
doubt, omit it — the UI falls back to a heuristic that infers from the
question text. Don't supply \`options\` for yes-no or text kinds.

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
          severity: { type: "string", enum: ["blocker", "recommended"] },
          // Plan U (full): optional widget hint + options for the UI form.
          widgetKind: {
            type: "string",
            enum: ["yes-no", "single-select", "text"],
            description: "Optional. Declare when answer shape is known so the UI renders the right control."
          },
          options: {
            type: "array",
            items: { type: "string" },
            minItems: 2,
            maxItems: 6,
            description: "Required when widgetKind=single-select (2-6 short labels). Must be omitted for yes-no and text kinds."
          }
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
