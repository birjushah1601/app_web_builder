import type { LLMMessage, LLMProvider } from "@atlas/llm-provider";
import { PlannerTriageReportSchema, type PlannerTriageReport } from "./types.js";

export const PLANNER_TRIAGE_MODEL =
  process.env.ATLAS_LLM_TRIAGE_MODEL ?? "anthropic/claude-haiku-4.5";

export interface PlannerTriageInput {
  userTurn: string;
  /** Optional classifier-derived suggested artifact kinds from startBuild. */
  suggestedKinds?: string[];
  llm: LLMProvider;
  triageModel?: string;
}

const TRIAGE_SYSTEM_PROMPT = `You are the Workflow Planner's triage pass.
Your job: detect genuine blocker ambiguities in a multi-artifact workflow request.

## Default to passing.
Most workflow requests are clear enough to proceed. Only raise blocker questions
for explicit ambiguity that cannot be resolved by OSS-first defaults:
  - auth provider: default = Keycloak
  - database: default = Postgres
  - storage: default = MinIO
  - email: default = Mailpit (dev), Postal (prod)
  - jobs: default = BullMQ
  - payments: default = Lago
  - search: default = Meilisearch
  - error tracking: default = GlitchTip
  - analytics: default = PostHog
  - feature flags: default = Unleash

ONLY mark severity="blocker" when:
1. The prompt explicitly contradicts these defaults (e.g., "use Stripe", "use Neon")
2. The prompt implies regulated data flows (HIPAA, PCI, GDPR, SOC2) requiring a
   specific provider choice that cannot default safely
3. The scope of artifacts is genuinely unclear (e.g., "build an app" — no hint
   at what tiers are needed)

For widgetKind:
  - "yes-no" — binary questions ("Should we include a GraphQL API?")
  - "single-select" — finite named choices, emit options[] (2-6 labels)
  - "text" — open-ended free-form answer

Call the emit_planner_triage tool exactly once.`;

const TRIAGE_TOOL_SCHEMA = {
  type: "object",
  properties: {
    passed: {
      type: "boolean",
      description: "true if no blocker-severity questions are present"
    },
    questions: {
      type: "array",
      items: {
        type: "object",
        properties: {
          question: { type: "string" },
          reason: { type: "string" },
          severity: { type: "string", enum: ["blocker", "recommended"] },
          widgetKind: {
            type: "string",
            enum: ["yes-no", "single-select", "text"],
            description: "Optional. Declare when answer shape is known."
          },
          options: {
            type: "array",
            items: { type: "string" },
            minItems: 2,
            maxItems: 6,
            description: "Required when widgetKind=single-select."
          }
        },
        required: ["question", "reason", "severity"]
      }
    }
  },
  required: ["passed", "questions"]
} as const;

export class PlannerTriageFailedError extends Error {
  constructor(message: string, opts?: { cause?: unknown }) {
    super(message, opts as ErrorOptions);
    this.name = "PlannerTriageFailedError";
  }
}

export async function plannerTriage(input: PlannerTriageInput): Promise<PlannerTriageReport> {
  const model = input.triageModel ?? PLANNER_TRIAGE_MODEL;

  const kindsContext = input.suggestedKinds?.length
    ? `\nSuggested artifact kinds from classifier: ${input.suggestedKinds.join(", ")}`
    : "";

  const messages: LLMMessage[] = [
    { role: "system", content: TRIAGE_SYSTEM_PROMPT, cache_control: { type: "ephemeral" } },
    { role: "user", content: `Prompt: """${input.userTurn}"""${kindsContext}` }
  ];

  let result: { toolName: string; input: unknown };
  try {
    result = await (input.llm as unknown as {
      completeWithToolUse: (
        m: LLMMessage[],
        o: Record<string, unknown>
      ) => Promise<{ toolName: string; input: unknown }>;
    }).completeWithToolUse(messages, {
      model,
      maxTokens: 2048,
      tools: [
        {
          name: "emit_planner_triage",
          description: "Emit the planner triage result with blocker questions",
          input_schema: TRIAGE_TOOL_SCHEMA
        }
      ],
      toolChoice: { type: "tool", name: "emit_planner_triage" }
    });
  } catch (err) {
    const causeMsg = err instanceof Error ? err.message : String(err);
    throw new PlannerTriageFailedError(`plannerTriage LLM call failed: ${causeMsg}`, { cause: err });
  }

  const parse = PlannerTriageReportSchema.safeParse(result.input);
  if (!parse.success) {
    throw new PlannerTriageFailedError(
      `plannerTriage tool_use payload failed PlannerTriageReportSchema: ${parse.error.message}`,
      { cause: parse.error }
    );
  }
  return parse.data;
}
