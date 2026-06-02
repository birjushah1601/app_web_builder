// packages/role-iac/src/rubric.ts
import type { LLMProvider } from "@atlas/llm-provider";
import type { RoleInvocation } from "@atlas/conductor";
import type { Rubric, JudgeResult, StructuralResult } from "@atlas/eval-runtime";
import { JUDGE_TOOL_SCHEMA, JUDGE_TOOL_NAME, JudgeResultSchema } from "@atlas/eval-runtime";
import { IacArtifactSchema, type IacArtifact } from "@atlas/workflow-engine";

const VERSION = "iac@1.0.0";
const DEFAULT_MODEL = "anthropic/claude-sonnet-4.5";

const SYSTEM_PROMPT = `You are an evaluator for Atlas's IaC role.
Score each dimension 0-10. Pass threshold: every dimension >= 6.
Dimensions:
- compose_validity: does docker-compose.yml look like a syntactically valid compose file with at least one service?
- k8s_completeness: do the k8s manifests cover each declared service with a runnable resource (Service/Deployment/Knative)?
- env_contract_coverage: does each service's envContract include the env vars the upstream runtime artifact required?`;

export const iacRubric: Rubric<IacArtifact> = {
  roleId: "iac",
  version: VERSION,
  judgeModel: process.env.ATLAS_EVAL_IAC_MODEL ?? DEFAULT_MODEL,

  structural(output: IacArtifact, _inv: RoleInvocation): StructuralResult {
    const failures: Array<{ check: string; reason: string }> = [];

    // schema: artifact must round-trip through IacArtifactSchema
    const parsed = IacArtifactSchema.safeParse(output);
    if (!parsed.success) {
      failures.push({ check: "schema", reason: `IacArtifactSchema validation failed: ${parsed.error.message}` });
      // If schema fails, downstream checks may NPE — return early.
      return { passed: false, failures };
    }

    // services_present: at least one service declared
    if (parsed.data.services.length < 1) {
      failures.push({ check: "services_present", reason: "services array is empty" });
    }

    // k8s_manifest_present: at least one k8s manifest
    if (parsed.data.k8s.manifests.length < 1) {
      failures.push({ check: "k8s_manifest_present", reason: "k8s.manifests array is empty" });
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

function renderJudgeUserTurn(userTurn: string, output: IacArtifact): string {
  const composePreview = output.compose.content.length > 4000
    ? output.compose.content.slice(0, 4000) + "\n... [truncated]"
    : output.compose.content;
  const manifestSummary = output.k8s.manifests
    .map((m) => `- ${m.file} (${m.kind}/${m.name})`)
    .join("\n");
  const serviceSummary = output.services
    .map((s) => `- ${s.name} → ${s.runtimeNodeId} (${s.artifactKind}), env: [${s.envContract.map((e) => e.name).join(", ")}]`)
    .join("\n");
  return `User asked for:\n"""${userTurn}"""\n\nIaC role produced:\n\nServices:\n${serviceSummary}\n\nK8s manifests:\n${manifestSummary}\n\ndocker-compose.yml:\n\`\`\`yaml\n${composePreview}\n\`\`\`\n\nScore each dimension 0-10. Return verdict via the 'verdict' tool.`;
}
