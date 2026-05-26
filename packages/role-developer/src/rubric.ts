// packages/role-developer/src/rubric.ts
import type { LLMProvider } from "@atlas/llm-provider";
import type { RoleInvocation } from "@atlas/conductor";
import type { Rubric, JudgeResult, StructuralResult } from "@atlas/eval-runtime";
import { JUDGE_TOOL_SCHEMA, JUDGE_TOOL_NAME, JudgeResultSchema } from "@atlas/eval-runtime";
import type { DeveloperOutput } from "./types.js";

const VERSION = "developer@1.0.0";
const DEFAULT_MODEL = "anthropic/claude-sonnet-4.5";

const SYSTEM_PROMPT = `You are an evaluator for Atlas's Developer role.
Score each dimension 0-10. Pass threshold: every dimension >= 6.
Dimensions:
- plan_adherence: does the diff implement what the architect's plan specified?
- completeness: are all required files/changes present, or is the diff truncated/stubbed?
- syntactic_plausibility: does the diff look syntactically valid (proper unified diff format, no obvious broken code)?
- no_truncation: is the diff fully written out, not cut off mid-file?`;

export const developerRubric: Rubric<DeveloperOutput> = {
  roleId: "developer",
  version: VERSION,
  judgeModel: process.env.ATLAS_EVAL_DEVELOPER_MODEL ?? DEFAULT_MODEL,

  structural(output: DeveloperOutput, _inv: RoleInvocation): StructuralResult {
    const failures: Array<{ check: string; reason: string }> = [];

    // diff_present: non-empty diff
    if (!output.diff || output.diff.trim().length === 0) {
      failures.push({ check: "diff_present", reason: "diff is empty" });
    }

    // diff_format: must have at least one diff --git header
    if (output.diff && !/^diff --git /m.test(output.diff)) {
      failures.push({ check: "diff_format", reason: "diff has no 'diff --git' headers" });
    }

    // new_app_page: for new-app scope, diff must touch a page file
    const scope = (_inv as any).priorArtifact?.scope ?? ((_inv as any).architectArtifact as any)?.scope;
    if (scope === "new-app") {
      const touchesPage = /page\.(tsx?|jsx?)/.test(output.diff ?? "");
      if (!touchesPage) {
        failures.push({ check: "new_app_page", reason: "new-app scope diff does not touch a page file" });
      }
    }

    // summary_meaningful: at least 20 chars
    if (!output.summary || output.summary.trim().length < 20) {
      failures.push({ check: "summary_meaningful", reason: "summary is too short (< 20 chars)" });
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

function renderJudgeUserTurn(userTurn: string, output: DeveloperOutput): string {
  // Truncate large diffs for the judge to avoid token explosion
  const diffPreview = output.diff.length > 8000
    ? output.diff.slice(0, 8000) + "\n... [truncated for evaluation]"
    : output.diff;
  return `User asked for:\n"""${userTurn}"""\n\nDeveloper produced:\nSummary: ${output.summary}\n\nDiff:\n\`\`\`diff\n${diffPreview}\n\`\`\`\n\nScore each dimension 0-10. Return verdict via the 'verdict' tool.`;
}
