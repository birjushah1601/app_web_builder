// packages/role-architect/src/rubric.ts
import type { LLMProvider } from "@atlas/llm-provider";
import type { RoleInvocation } from "@atlas/conductor";
import type { Rubric, JudgeResult, StructuralResult } from "@atlas/eval-runtime";
import { JUDGE_TOOL_SCHEMA, JUDGE_TOOL_NAME, JudgeResultSchema } from "@atlas/eval-runtime";
import type { ArchitectOutput } from "./types.js";

const VERSION = "architect@1.0.0";
const DEFAULT_MODEL = "anthropic/claude-haiku-4.5";

const SYSTEM_PROMPT = `You are an evaluator for Atlas's Architect role.
Score each dimension 0-10. Pass threshold: every dimension >= 6.
Dimensions:
- intent_coverage: does the plan address what the user asked for?
- specificity: concrete enough for the developer?
- feasibility: achievable in the current sandbox template?
- scope_match: is the scope classification correct?`;

export const architectRubric: Rubric<ArchitectOutput> = {
  roleId: "architect",
  version: VERSION,
  judgeModel: process.env.ATLAS_EVAL_ARCHITECT_MODEL,

  structural(output: ArchitectOutput, _inv: RoleInvocation): StructuralResult {
    const failures: Array<{ check: string; reason: string }> = [];

    if (!output.scope) {
      failures.push({ check: "scope_present", reason: "Missing scope" });
    }
    if (output.scope === "new-app") {
      const tasks = (output as any).runnablePlan?.tasks ?? [];
      if (tasks.length < 1) {
        failures.push({ check: "plan_has_tasks", reason: "runnablePlan.tasks is empty for new-app" });
      }
    }
    const kind = (output as any).canvasManifest?.artifactKind as string | undefined;
    if (kind === "frontend-app" || kind?.startsWith("backend-")) {
      const modes = (output as any).canvasManifest?.modes ?? [];
      if (modes.length < 1) {
        failures.push({ check: "canvas_modes", reason: "canvasManifest has no modes" });
      }
    }
    if (!/^sha256:[0-9a-f]{64}$/.test((output as any).graphSlice?.hash ?? "")) {
      failures.push({ check: "graph_slice_hash", reason: "graphSlice.hash is not sha256" });
    }

    return failures.length === 0 ? { passed: true } : { passed: false, failures };
  },

  async judge(output, inv, llm): Promise<JudgeResult> {
    const userTurn = renderJudgeUserTurn(inv.userTurn, output);
    const result = await (llm as any).completeWithToolUse(
      [
        { role: "system", content: SYSTEM_PROMPT },
        { role: "user", content: userTurn }
      ],
      {
        model: this.judgeModel ?? DEFAULT_MODEL,
        maxTokens: 1500,
        tools: [{ name: JUDGE_TOOL_NAME, description: "Emit verdict", input_schema: JUDGE_TOOL_SCHEMA }],
        toolChoice: { type: "tool", name: JUDGE_TOOL_NAME }
      }
    );
    return JudgeResultSchema.parse(result.input);
  }
};

function renderJudgeUserTurn(userTurn: string, output: ArchitectOutput): string {
  return `User asked for:\n"""${userTurn}"""\n\nArchitect produced:\n\`\`\`json\n${JSON.stringify(output, null, 2)}\n\`\`\`\n\nScore each dimension 0-10. Return verdict via the 'verdict' tool.`;
}
