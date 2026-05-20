import type { LLMMessage, LLMProvider } from "@atlas/llm-provider";
import type { SkillRegistry } from "@atlas/skill-runtime";
import { assembleMigrationPlannerPrompt } from "./assemble-prompt.js";
import { MigrationPlanGenerationError } from "./errors.js";
import { MigrationPlanSchema, type MigrationPlan } from "./types.js";

export const MIGRATION_PLANNER_MODEL = "claude-opus-4-7";

export const MIGRATION_PLANNER_SKILLS = [
  "assess-source-topology",
  "assess-target-topology",
  "plan-dual-run",
  "plan-traffic-shift",
  "plan-cutover-decommission"
] as const;

const PLAN_TOOL_SCHEMA = {
  type: "object",
  properties: {
    sourceTopologyRef: { type: "string" },
    targetTopologyRef: { type: "string" },
    stages: {
      type: "array",
      items: {
        type: "object",
        properties: {
          kind: {
            type: "string",
            enum: ["dual-run", "traffic-shift", "verify", "cutover", "decommission"]
          },
          name: { type: "string" },
          description: { type: "string" },
          durationEstimateHours: { type: "integer", minimum: 0 },
          rollbackProcedure: { type: "string" },
          successCriteria: { type: "array", items: { type: "string" } },
          risks: { type: "array", items: { type: "string" } }
        },
        required: [
          "kind",
          "name",
          "description",
          "durationEstimateHours",
          "rollbackProcedure",
          "successCriteria"
        ]
      },
      minItems: 5,
      maxItems: 5
    },
    totalEstimateHours: { type: "integer", minimum: 1 },
    prerequisites: { type: "array", items: { type: "string" }, minItems: 1 },
    operatorNotes: { type: "string" }
  },
  required: [
    "sourceTopologyRef",
    "targetTopologyRef",
    "stages",
    "totalEstimateHours",
    "prerequisites",
    "operatorNotes"
  ]
} as const;

export interface GeneratePlanInput {
  llm: LLMProvider;
  skills: SkillRegistry;
  sourceTopologyRef: string;
  targetTopologyRef: string;
  graphSlice: { bytes: string; hash: string };
  model?: string;
}

export async function generateMigrationPlan(input: GeneratePlanInput): Promise<MigrationPlan> {
  const skillPrompt = assembleMigrationPlannerPrompt(input.skills, [...MIGRATION_PLANNER_SKILLS]);
  const systemPrompt = `You are the Atlas Migration Planner role. Read the source + target WorkloadTopology nodes from the graph slice and emit a 5-stage zero-downtime migration plan via the emit_migration_plan tool. Stages MUST be in order: dual-run, traffic-shift, verify, cutover, decommission. totalEstimateHours MUST equal the sum of stage durations.\n\n${skillPrompt}`;
  const messages: LLMMessage[] = [
    { role: "system", content: systemPrompt, cache_control: { type: "ephemeral" } },
    {
      role: "system",
      content: `<graph-slice hash="${input.graphSlice.hash}">\n${input.graphSlice.bytes}\n</graph-slice>`
    },
    {
      role: "user",
      content: `Plan a migration from source topology "${input.sourceTopologyRef}" to target topology "${input.targetTopologyRef}".`
    }
  ];
  let result;
  try {
    result = await (
      input.llm as unknown as {
        completeWithToolUse: (
          m: LLMMessage[],
          o: Record<string, unknown>
        ) => Promise<{ toolName: string; input: unknown }>;
      }
    ).completeWithToolUse(messages, {
      model: input.model ?? MIGRATION_PLANNER_MODEL,
      maxTokens: 8192,
      tools: [
        {
          name: "emit_migration_plan",
          description: "Emit the 5-stage migration plan",
          input_schema: PLAN_TOOL_SCHEMA
        }
      ],
      toolChoice: { type: "tool", name: "emit_migration_plan" }
    });
  } catch (err) {
    throw new MigrationPlanGenerationError("migration-planner LLM call failed", { cause: err });
  }
  const parse = MigrationPlanSchema.safeParse(result.input);
  if (!parse.success) {
    throw new MigrationPlanGenerationError("migration-plan tool_use payload failed schema", {
      cause: parse.error
    });
  }
  return parse.data;
}
