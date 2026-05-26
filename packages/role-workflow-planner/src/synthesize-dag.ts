import type { LLMMessage, LLMProvider } from "@atlas/llm-provider";
import { DagSynthesisOutputSchema, type DagSynthesisOutput, ALLOWED_ARTIFACT_KINDS } from "./types.js";
import type { PlannerTriageReport } from "./types.js";

export const PLANNER_SYNTH_MODEL =
  process.env.ATLAS_LLM_DEEP_MODEL ?? "anthropic/claude-opus-4-5";

export interface SynthesizeDagInput {
  userTurn: string;
  triageReport: PlannerTriageReport;
  suggestedKinds?: string[];
  llm: LLMProvider;
  synthModel?: string;
}

// OSS-first defaults embedded inline so this package-level module has no
// app-side dependency. Keep in sync with apps/atlas-web/lib/llm/dependency-profile-defaults.ts.
const OSS_DEFAULTS_CONTEXT = `
## OSS-first dependency defaults
Unless the user's prompt explicitly overrides, use these providers:
- auth: Keycloak (provider="keycloak")
- db: Postgres (provider="postgres", connectionStringEnvVar="DATABASE_URL")
- storage: MinIO (provider="minio", bucketEnvVar="S3_BUCKET")
- email: Mailpit for dev (provider="mailpit")
- jobs: BullMQ (provider="bullmq", redisUrlEnvVar="REDIS_URL")
- payments: Lago (provider="lago")
- search: Meilisearch (provider="meilisearch", apiKeyEnvVar="MEILI_KEY")
- errorTracking: GlitchTip (provider="glitchtip", dsnEnvVar="GLITCHTIP_DSN")
- analytics: PostHog (provider="posthog", apiKeyEnvVar="POSTHOG_KEY")
- featureFlags: Unleash (provider="unleash", urlEnvVar="UNLEASH_URL")

Only include a concern in dependencyProfile if it is relevant to the prompt.
A "landing page" prompt needs no auth/payments/jobs.
schemaVersion must always be "1".
`.trim();

const SYSTEM_PROMPT = `You are the Workflow Planner's DAG synthesis pass.
Given a user's multi-artifact workflow prompt and any triage clarifications,
emit a directed acyclic graph (DAG) of artifact nodes, a dependency profile,
and brief reasoning.

${OSS_DEFAULTS_CONTEXT}

## Allowed artifactKind values
${ALLOWED_ARTIFACT_KINDS.join(", ")}

## Node rules
- id: short kebab-case string, unique within the DAG
- dependsOn: list of node ids this node must wait for
- consumes: subset of dependsOn (ids whose artifacts this node reads)
- summary: ≤ 120 chars describing what the node builds

## DAG rules
- No cycles
- Tests should depend on the nodes they test
- Deploy should depend on all production nodes

Call the emit_dag tool exactly once.`;

const SYNTHESIZE_TOOL_SCHEMA = {
  type: "object",
  properties: {
    nodes: {
      type: "array",
      items: {
        type: "object",
        properties: {
          id: { type: "string" },
          artifactKind: {
            type: "string",
            enum: [...ALLOWED_ARTIFACT_KINDS]
          },
          summary: { type: "string" },
          dependsOn: { type: "array", items: { type: "string" } },
          consumes: { type: "array", items: { type: "string" } }
        },
        required: ["id", "artifactKind", "summary", "dependsOn", "consumes"]
      }
    },
    dependencyProfile: {
      type: "object",
      properties: {
        schemaVersion: { type: "string", enum: ["1"] },
        auth: { type: "object", properties: { provider: { type: "string" } } },
        db: { type: "object", properties: { provider: { type: "string" }, connectionStringEnvVar: { type: "string" } } },
        storage: { type: "object", properties: { provider: { type: "string" }, bucketEnvVar: { type: "string" } } },
        email: { type: "object", properties: { provider: { type: "string" } } },
        jobs: { type: "object", properties: { provider: { type: "string" }, redisUrlEnvVar: { type: "string" } } },
        payments: { type: "object", properties: { provider: { type: "string" } } },
        search: { type: "object", properties: { provider: { type: "string" }, apiKeyEnvVar: { type: "string" } } },
        errorTracking: { type: "object", properties: { provider: { type: "string" }, dsnEnvVar: { type: "string" } } },
        analytics: { type: "object", properties: { provider: { type: "string" }, apiKeyEnvVar: { type: "string" } } },
        featureFlags: { type: "object", properties: { provider: { type: "string" }, urlEnvVar: { type: "string" } } }
      },
      required: ["schemaVersion"]
    },
    reasoning: { type: "string" }
  },
  required: ["nodes", "dependencyProfile", "reasoning"]
} as const;

export class DagSynthesisFailedError extends Error {
  constructor(message: string, opts?: { cause?: unknown }) {
    super(message, opts as ErrorOptions);
    this.name = "DagSynthesisFailedError";
  }
}

export async function synthesizeDag(input: SynthesizeDagInput): Promise<DagSynthesisOutput> {
  const model = input.synthModel ?? PLANNER_SYNTH_MODEL;

  const kindsHint = input.suggestedKinds?.length
    ? `\nClassifier suggested kinds: ${input.suggestedKinds.join(", ")}`
    : "";

  const answeredQuestions = input.triageReport.questions
    .filter((q) => q.severity === "blocker")
    .map((q) => `Q: ${q.question}`)
    .join("\n");

  const userContent = [
    `Prompt: """${input.userTurn}"""`,
    kindsHint,
    answeredQuestions ? `\nTriage clarifications:\n${answeredQuestions}` : ""
  ]
    .filter(Boolean)
    .join("");

  const messages: LLMMessage[] = [
    { role: "system", content: SYSTEM_PROMPT, cache_control: { type: "ephemeral" } },
    { role: "user", content: userContent }
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
      maxTokens: 8192,
      tools: [
        {
          name: "emit_dag",
          description: "Emit the workflow DAG with nodes, dependencyProfile, and reasoning",
          input_schema: SYNTHESIZE_TOOL_SCHEMA
        }
      ],
      toolChoice: { type: "tool", name: "emit_dag" }
    });
  } catch (err) {
    const causeMsg = err instanceof Error ? err.message : String(err);
    throw new DagSynthesisFailedError(`synthesizeDag LLM call failed: ${causeMsg}`, { cause: err });
  }

  const parse = DagSynthesisOutputSchema.safeParse(result.input);
  if (!parse.success) {
    throw new DagSynthesisFailedError(
      `synthesizeDag tool_use payload failed schema validation: ${parse.error.message}`,
      { cause: parse.error }
    );
  }
  return parse.data;
}
