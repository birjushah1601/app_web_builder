// packages/role-tester/src/rubric.ts
import type { LLMProvider } from "@atlas/llm-provider";
import type { RoleInvocation } from "@atlas/conductor";
import type { Rubric, JudgeResult, StructuralResult } from "@atlas/eval-runtime";
import { JUDGE_TOOL_SCHEMA, JUDGE_TOOL_NAME, JudgeResultSchema } from "@atlas/eval-runtime";
import { TestsArtifactSchema, type TestsArtifact } from "@atlas/workflow-engine";

const VERSION = "tester@1.0.0";
const DEFAULT_MODEL = "anthropic/claude-sonnet-4.5";

const SYSTEM_PROMPT = `You are an evaluator for Atlas's Tests role.
Score each dimension 0-10. Pass threshold: every dimension >= 6.
Dimensions:
- spec_relevance: do the generated specs actually exercise behaviour of the upstream artifact's surface?
- pass_signal: do the spec results indicate the suite ran at all (passed + failed > 0, not all skipped)?
- failure_quality: when failures exist, do the lastError messages look like real assertion failures rather than runner crashes?`;

export const testsRubric: Rubric<TestsArtifact> = {
  roleId: "tester",
  version: VERSION,
  judgeModel: process.env.ATLAS_EVAL_TESTER_MODEL ?? DEFAULT_MODEL,

  structural(output: TestsArtifact, _inv: RoleInvocation): StructuralResult {
    const failures: Array<{ check: string; reason: string }> = [];

    // schema: artifact must round-trip through TestsArtifactSchema
    const parsed = TestsArtifactSchema.safeParse(output);
    if (!parsed.success) {
      failures.push({ check: "schema", reason: `TestsArtifactSchema validation failed: ${parsed.error.message}` });
      return { passed: false, failures };
    }

    // specs_present: at least one spec result
    if (parsed.data.specs.length < 1) {
      failures.push({ check: "specs_present", reason: "specs array is empty" });
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

function renderJudgeUserTurn(userTurn: string, output: TestsArtifact): string {
  const specSummary = output.specs
    .map((s) => {
      const errSuffix = s.lastError ? `\n    error: ${s.lastError.slice(0, 200)}` : "";
      return `- ${s.file} → targets=[${s.targets.join(", ")}] passed=${s.passed} failed=${s.failed} skipped=${s.skipped} (${s.durationMs}ms)${errSuffix}`;
    })
    .join("\n");
  const coverageLine = output.coverage
    ? `\nCoverage: lines=${output.coverage.lines}%, branches=${output.coverage.branches}%`
    : "";
  return `User asked for:\n"""${userTurn}"""\n\nTests role produced (framework: ${output.framework}):\n\nSpecs:\n${specSummary}${coverageLine}\n\nScore each dimension 0-10. Return verdict via the 'verdict' tool.`;
}
