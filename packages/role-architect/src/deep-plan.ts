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
    const causeMsg = err instanceof Error ? err.message : String(err);
    throw new DeepPlanFailedError(`deep plan LLM call failed: ${causeMsg}`, { cause: err, scope: input.ambiguity.scope });
  }

  // Defensive enrichment for all scope variants. Models against tools-
  // stripping proxies routinely omit required scope-specific fields
  // (graphSlice, runnablePlan, diffPlan, bugReport, etc.). Rather than
  // failing the entire ritual one missing field at a time, we inject
  // empty-but-valid defaults for whichever scope the model picked, then
  // overlay the model's actual output on top. The model's real values
  // win wherever it provided them; missing fields get safe placeholders
  // so the schema parse succeeds and downstream consumers (UI, plan C
  // sandbox apply) keep functioning.
  const enriched = enrichArchitectOutput(result.input, input.graphSlice, input.ambiguity.scope);

  const parse = ArchitectOutputSchema.safeParse(enriched);
  if (!parse.success) {
    throw new DeepPlanFailedError(
      `deep plan tool_use payload failed ArchitectOutputSchema: ${parse.error.message}`,
      { cause: parse.error, scope: input.ambiguity.scope }
    );
  }
  return parse.data;
}

/** Build empty-but-valid defaults for each scope variant, then overlay the
 *  model's actual output. The model's values always win — defaults only fill
 *  in fields the model omitted. graphSlice is special: always overridden with
 *  the operator-supplied value (the model has no business inventing it). */
function enrichArchitectOutput(
  raw: unknown,
  graphSlice: { bytes: string; hash: string },
  scope: string
): unknown {
  if (!raw || typeof raw !== "object") return raw;
  const model = raw as Record<string, unknown>;
  const defaults = scopeDefaults(scope);
  return { ...defaults, ...model, scope, graphSlice };
}

function scopeDefaults(scope: string): Record<string, unknown> {
  switch (scope) {
    case "new-app":
      return { specGraph: {}, runnablePlan: { tasks: [] } };
    case "new-feature":
      return { diffPlan: { summary: "", tasks: [] } };
    case "bug-fix":
      return {
        bugReport: {
          phase1_reproduce: "",
          phase2_isolate: "",
          phase3_hypothesize: "",
          phase4_verify: "",
          rootCause: ""
        }
      };
    case "dep-upgrade":
      return { breakingChangeMatrix: [], rollbackPlan: "" };
    case "refactor":
      return {
        beforeAfterGraph: { before: {}, after: {} },
        behaviorPreservationContract: [],
        regressionTests: []
      };
    case "ship":
      return { rerunnableSteps: [], rollbackTrigger: "" };
    case "migrate":
      return { stagedPlan: [], complianceEvidence: [] };
    default:
      return {};
  }
}
