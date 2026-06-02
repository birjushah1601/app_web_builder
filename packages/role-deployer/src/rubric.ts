// packages/role-deployer/src/rubric.ts
import type { LLMProvider } from "@atlas/llm-provider";
import type { RoleInvocation } from "@atlas/conductor";
import type { Rubric, JudgeResult, StructuralResult } from "@atlas/eval-runtime";
import { JUDGE_TOOL_SCHEMA, JUDGE_TOOL_NAME, JudgeResultSchema } from "@atlas/eval-runtime";
import { DeployArtifactSchema, type DeployArtifact } from "@atlas/workflow-engine";

const VERSION = "deployer@1.0.0";
const DEFAULT_MODEL = "anthropic/claude-sonnet-4.5";

const SYSTEM_PROMPT = `You are an evaluator for Atlas's Deployer role.
Score each dimension 0-10. Pass threshold: every dimension >= 6.
Dimensions:
- argo_application_validity: does the ArgoApplication manifest look like a syntactically valid Application with name/repo/path set?
- image_build_coverage: is there an imageBuild entry for each runtime service implied by the upstream IaC artifact?
- smoke_test_plausibility: are the smoke tests pointed at plausible URLs with sensible expected status codes (2xx for /health)?`;

export const deployerRubric: Rubric<DeployArtifact> = {
  roleId: "deployer",
  version: VERSION,
  judgeModel: process.env.ATLAS_EVAL_DEPLOYER_MODEL ?? DEFAULT_MODEL,

  structural(output: DeployArtifact, _inv: RoleInvocation): StructuralResult {
    const failures: Array<{ check: string; reason: string }> = [];

    // schema: artifact must round-trip through DeployArtifactSchema
    const parsed = DeployArtifactSchema.safeParse(output);
    if (!parsed.success) {
      failures.push({ check: "schema", reason: `DeployArtifactSchema validation failed: ${parsed.error.message}` });
      return { passed: false, failures };
    }

    // argo_app_name_present: name must be non-empty (defence-in-depth; schema
    // already enforces min(1) but the rubric records its own bucket so eval
    // verdicts surface the intent rather than a raw zod error).
    if (!parsed.data.argoApplication.name || parsed.data.argoApplication.name.trim().length === 0) {
      failures.push({ check: "argo_app_name_present", reason: "argoApplication.name is empty" });
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

function renderJudgeUserTurn(userTurn: string, output: DeployArtifact): string {
  const argoPreview = output.argoApplication.content.length > 3000
    ? output.argoApplication.content.slice(0, 3000) + "\n... [truncated]"
    : output.argoApplication.content;
  const buildSummary = output.imageBuilds
    .map((b) => `- ${b.serviceName} → ${b.imageTag} (Dockerfile: ${b.dockerfilePath})`)
    .join("\n");
  const smokeSummary = output.smokeTests
    .map((s) => `- ${(s.method ?? "GET").toUpperCase()} ${s.url} → expect ${s.expectStatus}${s.expectBodyContains ? ` body~"${s.expectBodyContains}"` : ""}`)
    .join("\n");
  return `User asked for:\n"""${userTurn}"""\n\nDeployer role produced (target: ${output.target}):\n\nArgo application: ${output.argoApplication.name} (repo=${output.argoApplication.repoUrl}, path=${output.argoApplication.path})\n\`\`\`yaml\n${argoPreview}\n\`\`\`\n\nImage builds:\n${buildSummary}\n\nSmoke tests:\n${smokeSummary}\n\nScore each dimension 0-10. Return verdict via the 'verdict' tool.`;
}
