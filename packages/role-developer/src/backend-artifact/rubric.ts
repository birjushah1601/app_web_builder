// packages/role-developer/src/backend-artifact/rubric.ts
import type { LLMProvider } from "@atlas/llm-provider";
import type { RoleInvocation } from "@atlas/conductor";
import type { Rubric, JudgeResult, StructuralResult } from "@atlas/eval-runtime";
import { JUDGE_TOOL_SCHEMA, JUDGE_TOOL_NAME, JudgeResultSchema } from "@atlas/eval-runtime";
import { BackendArtifactSchema, type BackendArtifact } from "@atlas/workflow-engine";

const VERSION = "backend-artifact@1.0.0";
const DEFAULT_MODEL = "anthropic/claude-sonnet-4.5";

const SYSTEM_PROMPT = `You are an evaluator for Atlas's BackendArtifact role.
Score each dimension 0-10. Pass threshold: every dimension >= 6.
Dimensions:
- routes_coverage: do the extracted routes match the OpenAPI paths/methods, with no obvious omissions?
- openapi_validity: does the OpenAPI document look like a coherent 3.x spec (info, paths, response shapes)?
- env_contract_plausibility: does the env contract list reasonable variables for the routes/spec described?`;

export const backendArtifactRubric: Rubric<BackendArtifact> = {
  roleId: "backend-artifact",
  version: VERSION,
  judgeModel: process.env.ATLAS_EVAL_BACKEND_ARTIFACT_MODEL ?? DEFAULT_MODEL,

  structural(output: BackendArtifact, _inv: RoleInvocation): StructuralResult {
    const failures: Array<{ check: string; reason: string }> = [];

    // schema: artifact must round-trip through BackendArtifactSchema
    const parsed = BackendArtifactSchema.safeParse(output);
    if (!parsed.success) {
      failures.push({ check: "schema", reason: `BackendArtifactSchema validation failed: ${parsed.error.message}` });
      return { passed: false, failures };
    }

    // routes_present: at least one route extracted
    if (parsed.data.routes.length < 1) {
      failures.push({ check: "routes_present", reason: "routes array is empty" });
    }

    // openapi_paths_present: spec.paths must exist and have >= 1 entry
    const paths = (parsed.data.openApiSpec as { paths?: unknown }).paths;
    const hasPaths = paths && typeof paths === "object" && Object.keys(paths as Record<string, unknown>).length > 0;
    if (!hasPaths) {
      failures.push({ check: "openapi_paths_present", reason: "openApiSpec has no `paths` entries" });
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

function renderJudgeUserTurn(userTurn: string, output: BackendArtifact): string {
  const routeSummary = output.routes
    .map((r) => `- ${r.method.toUpperCase()} ${r.path}${r.opId ? ` (${r.opId})` : ""}`)
    .join("\n");
  const envSummary = output.envContract
    .map((e) => `- ${e.name}${e.required ? " (required)" : ""}`)
    .join("\n");
  const specJson = JSON.stringify(output.openApiSpec, null, 2);
  const specPreview = specJson.length > 6000 ? specJson.slice(0, 6000) + "\n... [truncated]" : specJson;
  return `User asked for:\n"""${userTurn}"""\n\nBackendArtifact role produced:\n\nRoutes:\n${routeSummary}\n\nEnv contract:\n${envSummary}\n\nOpenAPI:\n\`\`\`json\n${specPreview}\n\`\`\`\n\nScore each dimension 0-10. Return verdict via the 'verdict' tool.`;
}
