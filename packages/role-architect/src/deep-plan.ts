import type { LLMMessage, LLMProvider } from "@atlas/llm-provider";
import { buildPromptCacheBlocks } from "@atlas/conductor";
import type { SkillRegistry } from "@atlas/skill-runtime";
import { assembleArchitectPrompt } from "./assemble-prompt.js";
import { DeepPlanFailedError } from "./errors.js";
import {
  ArchitectOutputSchema,
  type AmbiguityReport,
  type ArchitectOutput
} from "./types.js";

export const ARCHITECT_DEEP_PLAN_MODEL = "claude-opus-4-7";

export interface DeepPlanInput {
  userTurn: string;
  graphSlice: { bytes: string; hash: string };
  ambiguity: AmbiguityReport;
  skills: SkillRegistry;
  llm: LLMProvider;
  deepPlanModel?: string;
}

const DEEP_PLAN_ROLE_PROMPT = `You are the Architect's deep-plan pass. Given a clarified user intent
and a Spec Graph slice, produce the scope-specific Visualize artifact per PRD §8:

- new-app → SpecGraph + wireframes + data model + flows + compliance class
- new-feature → impact-analysis diff plan
- bug-fix → four-phase debug report (reproduce → isolate → hypothesize → verify)
- dep-upgrade → breaking-change matrix + rollback plan
- refactor → before/after graph + behavior-preservation contract + regression tests
- ship → rerunnable steps + rollback trigger
- migrate → staged plan + compliance evidence

Compose brainstorm + spec-graph + runnable-plan skills as reference material.
Call the emit_architect_output tool exactly once with the scope-matched output.`;

const DEEP_PLAN_TOOL_SCHEMA = {
  type: "object",
  properties: {
    scope: {
      type: "string",
      enum: ["new-app", "new-feature", "bug-fix", "dep-upgrade", "refactor", "ship", "migrate"]
    },
    // Accept either shape; strict enforcement happens via Zod after the tool returns.
  },
  required: ["scope"]
} as const;

export async function deepPlan(input: DeepPlanInput): Promise<ArchitectOutput> {
  let skillPrompt: string;
  try {
    skillPrompt = assembleArchitectPrompt(input.skills, ["brainstorm", "spec-graph", "runnable-plan"]);
  } catch (err) {
    throw new DeepPlanFailedError(`required skill missing: ${(err as Error).message}`, {
      cause: err,
      scope: input.ambiguity.scope
    });
  }

  const model = input.deepPlanModel ?? ARCHITECT_DEEP_PLAN_MODEL;
  const roleSystem = `${DEEP_PLAN_ROLE_PROMPT}\n\n# Reference skills\n\n${skillPrompt}`;

  const messages = buildPromptCacheBlocks({
    rolePrompt: roleSystem,
    graphSlice: input.graphSlice,
    userTurn: `Scope: ${input.ambiguity.scope}\n\nUser intent: ${input.userTurn}`
  });

  let result;
  try {
    result = await (input.llm as unknown as {
      completeWithToolUse: (m: LLMMessage[], o: Record<string, unknown>) => Promise<{ toolName: string; input: unknown }>;
    }).completeWithToolUse(messages, {
      model,
      maxTokens: 8192,
      tools: [
        {
          name: "emit_architect_output",
          description: "Emit the scope-specific Visualize artifact",
          input_schema: DEEP_PLAN_TOOL_SCHEMA
        }
      ],
      toolChoice: { type: "tool", name: "emit_architect_output" }
    });
  } catch (err) {
    throw new DeepPlanFailedError("deep plan LLM call failed", { cause: err, scope: input.ambiguity.scope });
  }

  const parse = ArchitectOutputSchema.safeParse(result.input);
  if (!parse.success) {
    throw new DeepPlanFailedError("deep plan tool_use payload failed ArchitectOutputSchema", {
      cause: parse.error,
      scope: input.ambiguity.scope
    });
  }
  return parse.data;
}
